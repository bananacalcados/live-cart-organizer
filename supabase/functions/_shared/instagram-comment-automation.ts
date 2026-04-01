import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface CommentData {
  commentId: string;
  fromId: string;
  username: string | null;
  text: string;
  mediaType: string; // post, REELS, etc
}

interface Rule {
  id: string;
  name: string;
  trigger_type: string;
  trigger_keywords: string[];
  media_types: string[];
  action_reply_comment: boolean;
  reply_comment_text: string | null;
  action_send_dm: boolean;
  dm_message_text: string | null;
  action_trigger_automation: boolean;
  automation_flow_id: string | null;
  cooldown_minutes: number;
  ai_generate_reply: boolean;
  ai_prompt: string | null;
}

/**
 * Process a comment against all active automation rules.
 * Returns the list of actions taken.
 */
export async function processCommentAutomation(
  supabase: ReturnType<typeof createClient>,
  comment: CommentData
): Promise<{ actions: string[] }> {
  const actions: string[] = [];

  // Fetch active rules
  const { data: rules, error } = await supabase
    .from("instagram_comment_rules")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error || !rules || rules.length === 0) {
    return { actions };
  }

  const pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN");
  if (!pageAccessToken) {
    console.error("META_PAGE_ACCESS_TOKEN not set, skipping automations");
    return { actions };
  }

  const commentTextLower = comment.text.toLowerCase().trim();

  for (const rule of rules as Rule[]) {
    // Check media type match
    if (!rule.media_types.some(mt => mt.toLowerCase() === comment.mediaType.toLowerCase())) {
      continue;
    }

    // Check trigger match
    let triggered = false;
    if (rule.trigger_type === "all") {
      triggered = true;
    } else if (rule.trigger_type === "keyword") {
      triggered = rule.trigger_keywords.some(kw =>
        commentTextLower.includes(kw.toLowerCase().trim())
      );
    }

    if (!triggered) continue;

    // Check cooldown: was this user already actioned by this rule recently?
    const cooldownTime = new Date(Date.now() - rule.cooldown_minutes * 60 * 1000).toISOString();
    const { data: recentAction } = await supabase
      .from("instagram_comment_actions")
      .select("id")
      .eq("rule_id", rule.id)
      .eq("comment_id", comment.fromId) // use fromId for per-user cooldown
      .gte("created_at", cooldownTime)
      .limit(1);

    if (recentAction && recentAction.length > 0) {
      console.log(`Cooldown active for rule ${rule.name}, user ${comment.fromId}`);
      continue;
    }

    // Check dedup: exact comment already processed
    const { data: existingAction } = await supabase
      .from("instagram_comment_actions")
      .select("id")
      .eq("comment_id", comment.commentId)
      .eq("rule_id", rule.id)
      .limit(1);

    if (existingAction && existingAction.length > 0) {
      continue;
    }

    const usernameClean = comment.username?.replace("@", "") || "";

    // ── Action 1: Reply to comment publicly ──
    if (rule.action_reply_comment && rule.reply_comment_text) {
      try {
        const replyText = rule.reply_comment_text
          .replace("{username}", usernameClean)
          .replace("{comment}", comment.text);

        const res = await fetch(
          `https://graph.instagram.com/v25.0/${comment.commentId}/replies`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${pageAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ message: replyText }),
          }
        );

        const data = await res.json();
        const status = res.ok ? "sent" : "error";

        await supabase.from("instagram_comment_actions").insert({
          comment_id: comment.commentId,
          rule_id: rule.id,
          action_type: "reply",
          status,
          error_message: res.ok ? null : JSON.stringify(data),
        });

        if (res.ok) {
          actions.push(`reply:${rule.name}`);
          console.log(`✅ Replied to comment ${comment.commentId} via rule "${rule.name}"`);
        } else {
          console.error(`❌ Failed reply for rule "${rule.name}":`, data);
        }
      } catch (e) {
        console.error(`Error replying to comment:`, e);
      }
    }

    // ── Action 2: Send Private DM ──
    if (rule.action_send_dm && rule.dm_message_text) {
      try {
        const dmText = rule.dm_message_text
          .replace("{username}", usernameClean)
          .replace("{comment}", comment.text);

        // Use Private Reply API (comment_id based) — works within 7 days
        const res = await fetch(
          `https://graph.instagram.com/v25.0/me/messages`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${pageAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              recipient: { comment_id: comment.commentId },
              message: { text: dmText },
            }),
          }
        );

        const data = await res.json();
        const status = res.ok ? "sent" : "error";

        await supabase.from("instagram_comment_actions").insert({
          comment_id: comment.commentId,
          rule_id: rule.id,
          action_type: "dm",
          status,
          error_message: res.ok ? null : JSON.stringify(data),
        });

        if (res.ok) {
          actions.push(`dm:${rule.name}`);
          console.log(`✅ DM sent for comment ${comment.commentId} via rule "${rule.name}"`);

          // Also save the DM as a whatsapp_messages record for chat visibility
          await supabase.from("whatsapp_messages").insert({
            phone: comment.fromId,
            message: dmText,
            direction: "outgoing",
            message_id: data.message_id || null,
            status: "sent",
            media_type: "text",
            is_group: false,
            channel: "instagram",
            sender_name: comment.username,
          });
        } else {
          console.error(`❌ Failed DM for rule "${rule.name}":`, data);
        }
      } catch (e) {
        console.error(`Error sending DM:`, e);
      }
    }

    // ── Action 3: Trigger automation flow ──
    if (rule.action_trigger_automation && rule.automation_flow_id) {
      try {
        await supabase.from("instagram_comment_actions").insert({
          comment_id: comment.commentId,
          rule_id: rule.id,
          action_type: "automation",
          status: "triggered",
        });

        // Invoke the automation trigger
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        await fetch(`${supabaseUrl}/functions/v1/automation-trigger-incoming`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: comment.fromId,
            message: comment.text,
            flow_id: rule.automation_flow_id,
            source: "instagram_comment",
            metadata: {
              comment_id: comment.commentId,
              username: comment.username,
              media_type: comment.mediaType,
            },
          }),
        });

        actions.push(`automation:${rule.name}`);
        console.log(`✅ Automation triggered for comment ${comment.commentId} via rule "${rule.name}"`);
      } catch (e) {
        console.error(`Error triggering automation:`, e);
      }
    }
  }

  return { actions };
}
