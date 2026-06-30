import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBRPhone, textHasDigits } from "./br-phone-extract.ts";

interface CommentData {
  commentId: string;
  fromId: string;
  username: string | null;
  text: string;
  mediaType: string; // post, REELS, etc
  mediaId?: string | null; // the post/reel id the comment belongs to
}

interface PostThumb {
  media_url: string | null;
  permalink: string | null;
  media_type: string | null;
}

/**
 * Fetch the thumbnail of the post/reel/ad the comment belongs to, so it can be
 * shown next to the lead's first message in the chat (the "ad thumbnail").
 */
async function fetchCommentMediaThumb(
  commentId: string,
  token: string,
): Promise<PostThumb | null> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v25.0/${commentId}?fields=media{id,media_type,media_url,thumbnail_url,permalink}&access_token=${token}`,
    );
    if (!res.ok) {
      console.warn(`[comment-thumb] fetch failed ${res.status} for ${commentId}`);
      return null;
    }
    const data = await res.json();
    const media = data?.media;
    if (!media) return null;
    return {
      // VIDEO/REELS expose a thumbnail_url; IMAGE/CAROUSEL expose media_url
      media_url: media.thumbnail_url || media.media_url || null,
      permalink: media.permalink || null,
      media_type: media.media_type || null,
    };
  } catch (e) {
    console.warn(`[comment-thumb] error for ${commentId}:`, e);
    return null;
  }
}

export interface DmButton {
  label: string;
  type: "link" | "reply";
  url?: string | null;
  tags?: string[];
  reply_message?: string | null;
  flow_id?: string | null;
}

interface Rule {
  id: string;
  name: string;
  trigger_type: string;
  trigger_keywords: string[];
  media_types: string[];
  action_reply_comment: boolean;
  reply_comment_text: string | null;
  reply_comment_variations: string[] | null;
  action_send_dm: boolean;
  dm_message_text: string | null;
  dm_buttons: DmButton[] | null;
  action_trigger_automation: boolean;
  automation_flow_id: string | null;
  cooldown_minutes: number;
  ai_generate_reply: boolean;
  ai_prompt: string | null;
  target_media_id: string | null;
  // Captação de lead para evento (Live do Instagram)
  action_capture_lead: boolean;
  capture_event_id: string | null;
  capture_mode: string | null; // 'phone' | 'keyword'
  capture_fallback_dm_text: string | null;
}

function buildButtonPayload(ruleId: string, buttons: DmButton[]): any[] {
  const out: any[] = [];
  buttons.slice(0, 3).forEach((b, idx) => {
    if (!b?.label) return;
    if (b.type === "link" && b.url) {
      out.push({ type: "web_url", url: b.url, title: b.label.slice(0, 20) });
    } else if (b.type === "reply") {
      out.push({ type: "postback", title: b.label.slice(0, 20), payload: `igbtn:${ruleId}:${idx}` });
    }
  });
  return out;
}

function pickReplyText(rule: Rule): string | null {
  const variations = (rule.reply_comment_variations || []).filter((v) => v && v.trim());
  if (variations.length > 0) {
    return variations[Math.floor(Math.random() * variations.length)];
  }
  return rule.reply_comment_text;
}

/**
 * Normaliza o tipo de mídia para um conjunto canônico usado nas regras.
 * O Instagram envia media_product_type como FEED/AD/IMAGE/CAROUSEL_ALBUM/VIDEO
 * para posts comuns, mas a UI salva "post". Sem normalizar, a comparação por
 * igualdade estrita falha e a regra nunca dispara.
 */
function normMediaType(mt: string | null | undefined): string {
  const m = (mt || "").toLowerCase().trim();
  if (m === "reels" || m === "reel") return "reels";
  if (m === "igtv") return "igtv";
  if (m === "story" || m === "stories") return "story";
  if (m === "live") return "live";
  // feed, post, image, carousel_album, video, ad, etc. → post
  return "post";
}

const USER_COOLDOWN_ACTION_TYPE = "user_cooldown";
const DEFAULT_OWN_IG_USERNAMES = ["bananacalcados"];

function normalizeIgUsername(value: string | null | undefined): string {
  return (value || "").replace(/^@+/, "").trim().toLowerCase();
}

function ownIgUsernames(): string[] {
  const raw = [
    Deno.env.get("META_INSTAGRAM_USERNAME"),
    Deno.env.get("INSTAGRAM_USERNAME"),
    Deno.env.get("IG_USERNAME"),
    ...DEFAULT_OWN_IG_USERNAMES,
  ];

  return Array.from(new Set(raw.map(normalizeIgUsername).filter(Boolean)));
}

function isOwnInstagramUsername(username: string | null | undefined): boolean {
  const normalized = normalizeIgUsername(username);
  return Boolean(normalized && ownIgUsernames().includes(normalized));
}

function cooldownMarkerId(userId: string, cooldownMinutes: number): string {
  const minutes = Math.max(1, Number(cooldownMinutes) || 60);
  const bucket = Math.floor(Date.now() / (minutes * 60 * 1000));
  return `user:${userId}:${bucket}`;
}

async function hasRecentUserCooldown(
  supabase: ReturnType<typeof createClient>,
  ruleId: string,
  userId: string,
  cooldownMinutes: number,
): Promise<boolean> {
  if (!cooldownMinutes || cooldownMinutes <= 0) return false;

  const cooldownTime = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("instagram_comment_actions")
    .select("id")
    .eq("rule_id", ruleId)
    .eq("action_type", USER_COOLDOWN_ACTION_TYPE)
    .like("comment_id", `user:${userId}:%`)
    .gte("created_at", cooldownTime)
    .limit(1);

  if (error) {
    console.warn(`[ig-comment-automation] cooldown lookup failed for user ${userId}:`, error);
    return false;
  }

  return Boolean(data && data.length > 0);
}

async function reserveUserCooldown(
  supabase: ReturnType<typeof createClient>,
  rule: Rule,
  userId: string,
): Promise<boolean> {
  if (!rule.cooldown_minutes || rule.cooldown_minutes <= 0) return true;

  if (await hasRecentUserCooldown(supabase, rule.id, userId, rule.cooldown_minutes)) {
    console.log(`Cooldown active for rule ${rule.name}, user ${userId}`);
    return false;
  }

  const marker = cooldownMarkerId(userId, rule.cooldown_minutes);
  const { error } = await supabase.from("instagram_comment_actions").insert({
    comment_id: marker,
    rule_id: rule.id,
    action_type: USER_COOLDOWN_ACTION_TYPE,
    status: "locked",
  });

  if (!error) return true;

  if ((error as any).code === "23505") {
    console.log(`Cooldown lock already exists for rule ${rule.name}, user ${userId}`);
    return false;
  }

  console.warn(`[ig-comment-automation] cooldown lock failed for rule ${rule.name}, user ${userId}:`, error);
  return false;
}

async function reserveRuleAction(
  supabase: ReturnType<typeof createClient>,
  commentId: string,
  ruleId: string,
  actionType: "reply" | "dm" | "automation",
): Promise<string | null> {
  const { data, error } = await supabase
    .from("instagram_comment_actions")
    .insert({
      comment_id: commentId,
      rule_id: ruleId,
      action_type: actionType,
      status: "pending",
    })
    .select("id")
    .single();

  if (!error) return (data as any).id;

  if ((error as any).code !== "23505") {
    console.warn(`[ig-comment-automation] action reservation failed (${actionType}/${commentId}):`, error);
  }

  return null;
}

async function finishReservedAction(
  supabase: ReturnType<typeof createClient>,
  actionId: string,
  status: string,
  errorMessage: string | null = null,
) {
  const { error } = await supabase
    .from("instagram_comment_actions")
    .update({ status, error_message: errorMessage })
    .eq("id", actionId);

  if (error) {
    console.warn(`[ig-comment-automation] failed to update reserved action ${actionId}:`, error);
  }
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

  // Meta also delivers our own public replies as comment webhooks. If we let
  // those pass through, a keyword contained in the bot reply can trigger the
  // same rule again and create a visible reply loop on the post/reel.
  if (isOwnInstagramUsername(comment.username)) {
    console.log(`Skipping own Instagram comment automation for ${comment.username}`);
    return { actions };
  }

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

  // Lazily fetched once and reused across rules (undefined = not yet fetched).
  let postThumb: PostThumb | null | undefined = undefined;



  for (const rule of rules as Rule[]) {
    // Check media type match (normalizado: FEED/AD/IMAGE/etc. = post)
    if (!rule.media_types.some(mt => normMediaType(mt) === normMediaType(comment.mediaType))) {
      continue;
    }

    // Check per-post targeting: if the rule targets a specific media, the
    // comment must belong to that exact post/reel.
    if (rule.target_media_id) {
      if (!comment.mediaId || String(comment.mediaId) !== String(rule.target_media_id)) {
        continue;
      }
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

    // ── Captação de lead pela Live (extração de telefone do comentário) ──
    // captureEnabled exige a regra ligada + evento de destino definido.
    const captureEnabled = !!(rule.action_capture_lead && rule.capture_event_id);
    const captureMode = (rule.capture_mode || "phone").toLowerCase();
    let extractedPhone: string | null = null;
    let phoneLast4 = "";
    let isCaptureFallback = false;

    if (captureEnabled && captureMode === "phone") {
      const ext = extractBRPhone(comment.text);
      if (ext) {
        extractedPhone = ext.phone;
        phoneLast4 = ext.last4;
      } else {
        // Sem telefone válido: só seguimos (para mandar DM de fallback) quando
        // a pessoa tentou digitar algo numérico E há texto de fallback configurado.
        // Caso contrário, ignoramos sem gastar o cooldown — assim ela pode comentar
        // o número correto depois sem ficar travada.
        if (rule.capture_fallback_dm_text && textHasDigits(comment.text)) {
          isCaptureFallback = true;
        } else {
          continue;
        }
      }
    }

    // Reserve a per-user cooldown before calling Meta. This is intentionally
    // atomic (unique marker per cooldown bucket), so duplicate webhook deliveries
    // or multiple near-simultaneous comments cannot reply 4–5 times in parallel.
    if (!(await reserveUserCooldown(supabase, rule, comment.fromId))) {
      continue;
    }

    const usernameClean = comment.username?.replace("@", "") || "";

    // ── Captação: salva o lead no evento futuro (origem live_comment) ──
    let leadSaved = false;
    if (captureEnabled && captureMode === "phone" && extractedPhone) {
      const actionId = await reserveRuleAction(supabase, comment.commentId, rule.id, "capture_lead");
      if (actionId) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const res = await fetch(`${supabaseUrl}/functions/v1/event-lead-capture`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_id: rule.capture_event_id,
              source: "live_comment",
              name: comment.username || `@${usernameClean}` || extractedPhone,
              phone: extractedPhone,
              instagram: comment.username ? `@${usernameClean}` : null,
              utm_source: "instagram",
              utm_medium: "live_comment",
              metadata: {
                comment_id: comment.commentId,
                raw_text: comment.text,
                instagram: comment.username ? `@${usernameClean}` : null,
                ig_user_id: comment.fromId,
                rule_id: rule.id,
              },
            }),
          });
          const data = await res.json().catch(() => ({}));
          await finishReservedAction(supabase, actionId, res.ok ? "saved" : "error", res.ok ? null : JSON.stringify(data));
          if (res.ok) {
            leadSaved = true;
            actions.push(`lead:${rule.name}`);
            console.log(`✅ Lead da live capturado (${phoneLast4}) p/ evento ${rule.capture_event_id} via "${rule.name}"`);
          } else {
            console.error(`❌ Falha ao salvar lead da live para "${rule.name}":`, data);
          }
        } catch (e) {
          console.error("Erro ao capturar lead da live:", e);
          await finishReservedAction(supabase, actionId, "error", e instanceof Error ? e.message : String(e));
        }
      }
    }


    // ── Action 1: Reply to comment publicly (com variações anti-spam) ──
    const replyTemplate = pickReplyText(rule);
    if (rule.action_reply_comment && replyTemplate) {
      const actionId = await reserveRuleAction(supabase, comment.commentId, rule.id, "reply");
      if (!actionId) continue;

      try {
        const replyText = replyTemplate
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

        await finishReservedAction(supabase, actionId, status, res.ok ? null : JSON.stringify(data));

        if (res.ok) {
          actions.push(`reply:${rule.name}`);
          console.log(`✅ Replied to comment ${comment.commentId} via rule "${rule.name}"`);
        } else {
          console.error(`❌ Failed reply for rule "${rule.name}":`, data);
        }
      } catch (e) {
        console.error(`Error replying to comment:`, e);
        await finishReservedAction(supabase, actionId, "error", e instanceof Error ? e.message : String(e));
      }
    }

    // ── Action 2: Send Private DM ──
    // No fallback de captação (telefone não reconhecido) usamos o texto de
    // fallback pedindo o número correto, SEM botões. Caso contrário, segue o DM
    // normal da regra (ex.: confirmação + botão do Grupo VIP).
    const dmBaseText = isCaptureFallback ? rule.capture_fallback_dm_text : rule.dm_message_text;
    const shouldSendDm = isCaptureFallback ? !!rule.capture_fallback_dm_text : (rule.action_send_dm && !!rule.dm_message_text);
    if (shouldSendDm && dmBaseText) {
      const actionId = await reserveRuleAction(supabase, comment.commentId, rule.id, isCaptureFallback ? "dm_fallback" : "dm");
      if (!actionId) continue;

      try {
        const dmText = dmBaseText
          .replace(/\{username\}/g, usernameClean)
          .replace(/\{comment\}/g, comment.text)
          .replace(/\{last4\}/g, phoneLast4)
          .replace(/\{phone\}/g, extractedPhone || "");

        // Botões opcionais (button template). Máx 3 botões pela Meta.
        // No fallback não enviamos botões (só pedimos o número correto).
        const dmButtons = isCaptureFallback ? [] : buildButtonPayload(rule.id, rule.dm_buttons || []);
        const messagePayload = dmButtons.length > 0
          ? {
              attachment: {
                type: "template",
                payload: { template_type: "button", text: dmText.slice(0, 640), buttons: dmButtons },
              },
            }
          : { text: dmText };

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
              message: messagePayload,
            }),
          }
        );

        const data = await res.json();
        const status = res.ok ? "sent" : "error";

        await finishReservedAction(supabase, actionId, status, res.ok ? null : JSON.stringify(data));

        if (res.ok) {
          actions.push(`dm:${rule.name}`);
          console.log(`✅ DM sent for comment ${comment.commentId} via rule "${rule.name}"`);

          // The Private Reply API delivers to the user's messaging-scoped id,
          // which is what later inbound/echo events use. Persist everything under
          // that id so the comment automation lands in the SAME chat thread as
          // the lead's future replies (instead of an outgoing-only "Disparos" thread).
          const threadId: string = data.recipient_id || comment.fromId;

          // Fetch the post/ad thumbnail once (reused across rules).
          if (postThumb === undefined) {
            postThumb = await fetchCommentMediaThumb(comment.commentId, pageAccessToken);
          }

          const referral = {
            source_type: comment.mediaType?.toUpperCase() === "REELS" ? "reel" : "comment",
            media_url: postThumb?.media_url || null,
            source_url: postThumb?.permalink || null,
            headline: comment.mediaType?.toUpperCase() === "REELS"
              ? "Comentário no Reel"
              : "Comentário no anúncio/post",
            body: comment.text,
          };

          // Mirror the lead's first message (the comment) as INCOMING in the
          // canonical thread, with the ad/post thumbnail — but only once.
          const { data: existingIncoming } = await supabase
            .from("whatsapp_messages")
            .select("id")
            .eq("phone", threadId)
            .eq("channel", "instagram")
            .eq("direction", "incoming")
            .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .limit(1);

          if (!existingIncoming || existingIncoming.length === 0) {
            const { error: incErr } = await supabase.from("whatsapp_messages").insert({
              phone: threadId,
              message: comment.text,
              direction: "incoming",
              message_id: comment.commentId,
              status: "received",
              media_type: "text",
              is_group: false,
              channel: "instagram",
              sender_name: comment.username,
              referral,
            });
            if (incErr && (incErr as any).code !== "23505") {
              console.warn("[comment-dm] mirror incoming error:", incErr);
            }
          }

          // Save the DM as a whatsapp_messages record for chat visibility.
          await supabase.from("whatsapp_messages").insert({
            phone: threadId,
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
        await finishReservedAction(supabase, actionId, "error", e instanceof Error ? e.message : String(e));
      }
    }

    // ── Action 3: Trigger automation flow ──
    if (rule.action_trigger_automation && rule.automation_flow_id) {
      const actionId = await reserveRuleAction(supabase, comment.commentId, rule.id, "automation");
      if (!actionId) continue;

      try {
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

        await finishReservedAction(supabase, actionId, "triggered");

        actions.push(`automation:${rule.name}`);
        console.log(`✅ Automation triggered for comment ${comment.commentId} via rule "${rule.name}"`);
      } catch (e) {
        console.error(`Error triggering automation:`, e);
        await finishReservedAction(supabase, actionId, "error", e instanceof Error ? e.message : String(e));
      }
    }
  }

  return { actions };
}

interface StoryReplyData {
  fromId: string;          // sender id (used to DM back + cooldown)
  username: string | null;
  text: string;            // the reply text
  storyId?: string | null; // the story media id the user replied to
  messageId?: string | null;
}

/**
 * Process a Story reply against active automation rules whose media_types
 * include "story". Stories have no public comment, so only DM and flow
 * actions apply. Per-story targeting is honored via target_media_id.
 */
export async function processStoryReplyAutomation(
  supabase: ReturnType<typeof createClient>,
  reply: StoryReplyData,
): Promise<{ actions: string[] }> {
  const actions: string[] = [];

  const { data: rules, error } = await supabase
    .from("instagram_comment_rules")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error || !rules || rules.length === 0) return { actions };

  const pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN");
  if (!pageAccessToken) {
    console.error("META_PAGE_ACCESS_TOKEN not set, skipping story automations");
    return { actions };
  }

  const textLower = (reply.text || "").toLowerCase().trim();
  const dedupId = reply.messageId || `${reply.fromId}:${reply.storyId || "story"}`;

  for (const rule of rules as Rule[]) {
    // Only rules opted into stories
    if (!rule.media_types.some(mt => mt.toLowerCase() === "story")) continue;

    // Per-story targeting
    if (rule.target_media_id) {
      if (!reply.storyId || String(reply.storyId) !== String(rule.target_media_id)) {
        continue;
      }
    }

    // Trigger match
    let triggered = false;
    if (rule.trigger_type === "all") {
      triggered = true;
    } else if (rule.trigger_type === "keyword") {
      triggered = rule.trigger_keywords.some(kw =>
        textLower.includes(kw.toLowerCase().trim())
      );
    }
    if (!triggered) continue;

    // Atomic per-user cooldown for story replies too, preventing duplicate
    // webhook deliveries from sending several DMs in the same minute.
    if (!(await reserveUserCooldown(supabase, rule, reply.fromId))) {
      continue;
    }

    const usernameClean = reply.username?.replace("@", "") || "";

    // ── Action: Send DM (direct, since story replies arrive in the inbox) ──
    if (rule.action_send_dm && rule.dm_message_text) {
      const actionId = await reserveRuleAction(supabase, dedupId, rule.id, "dm");
      if (!actionId) continue;

      try {
        const dmText = rule.dm_message_text
          .replace("{username}", usernameClean)
          .replace("{comment}", reply.text);

        // Botões opcionais (button template). Máx 3 botões pela Meta.
        // Mesmo comportamento da automação de comentários: se houver botões
        // configurados na regra, envia como template "button" (web_url/postback).
        const dmButtons = buildButtonPayload(rule.id, rule.dm_buttons || []);
        const messagePayload = dmButtons.length > 0
          ? {
              attachment: {
                type: "template",
                payload: { template_type: "button", text: dmText.slice(0, 640), buttons: dmButtons },
              },
            }
          : { text: dmText };

        const res = await fetch(
          `https://graph.instagram.com/v25.0/me/messages`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${pageAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              recipient: { id: reply.fromId },
              message: messagePayload,
              messaging_type: "RESPONSE",
            }),
          }
        );
        const data = await res.json();
        const status = res.ok ? "sent" : "error";

        await finishReservedAction(supabase, actionId, status, res.ok ? null : JSON.stringify(data));

        if (res.ok) {
          actions.push(`dm:${rule.name}`);
          // Save outgoing DM for chat visibility
          await supabase.from("whatsapp_messages").insert({
            phone: reply.fromId,
            message: dmText,
            direction: "outgoing",
            message_id: data.message_id || null,
            status: "sent",
            media_type: "text",
            is_group: false,
            channel: "instagram",
            sender_name: reply.username,
          });
          console.log(`✅ Story DM sent to ${reply.fromId} via rule "${rule.name}"`);
        } else {
          console.error(`❌ Failed story DM for rule "${rule.name}":`, data);
        }
      } catch (e) {
        console.error(`Error sending story DM:`, e);
        await finishReservedAction(supabase, actionId, "error", e instanceof Error ? e.message : String(e));
      }
    }

    // ── Action: Trigger automation flow ──
    if (rule.action_trigger_automation && rule.automation_flow_id) {
      const actionId = await reserveRuleAction(supabase, dedupId, rule.id, "automation");
      if (!actionId) continue;

      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        await fetch(`${supabaseUrl}/functions/v1/automation-trigger-incoming`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: reply.fromId,
            message: reply.text,
            flow_id: rule.automation_flow_id,
            source: "instagram_story_reply",
            metadata: {
              story_id: reply.storyId,
              username: reply.username,
              media_type: "story",
            },
          }),
        });
        await finishReservedAction(supabase, actionId, "triggered");
        actions.push(`automation:${rule.name}`);
        console.log(`✅ Story automation triggered via rule "${rule.name}"`);
      } catch (e) {
        console.error(`Error triggering story automation:`, e);
        await finishReservedAction(supabase, actionId, "error", e instanceof Error ? e.message : String(e));
      }
    }
  }

  return { actions };
}

/**
 * Trata o clique em um botão de "resposta" (postback) enviado por uma DM de
 * automação de comentário. Payload esperado: `igbtn:<ruleId>:<buttonIdx>`.
 * Aplica as tags configuradas no contato, envia mensagem de retorno opcional e
 * dispara o fluxo de automação opcional.
 */
export async function handleCommentButtonPostback(
  supabase: ReturnType<typeof createClient>,
  payload: string,
  fromId: string,
  username: string | null,
): Promise<{ handled: boolean; actions: string[] }> {
  const actions: string[] = [];
  if (!payload || !payload.startsWith("igbtn:")) return { handled: false, actions };

  const parts = payload.split(":");
  const ruleId = parts[1];
  const buttonIdx = Number(parts[2]);
  if (!ruleId || Number.isNaN(buttonIdx)) return { handled: false, actions };

  const { data: rule } = await supabase
    .from("instagram_comment_rules")
    .select("id, name, dm_buttons")
    .eq("id", ruleId)
    .maybeSingle();
  if (!rule) return { handled: true, actions };

  const buttons = (rule as any).dm_buttons as DmButton[] | null;
  const button = buttons?.[buttonIdx];
  if (!button) return { handled: true, actions };

  // ── Aplicar TAGs no contato (merge sem duplicar) ──
  if (button.tags && button.tags.length > 0) {
    try {
      const { data: existing } = await supabase
        .from("chat_contacts")
        .select("tags")
        .eq("phone", fromId)
        .maybeSingle();
      const current: string[] = ((existing as any)?.tags as string[]) || [];
      const merged = Array.from(new Set([...current, ...button.tags.map((t) => t.trim()).filter(Boolean)]));
      await supabase.from("chat_contacts").upsert(
        { phone: fromId, tags: merged, updated_at: new Date().toISOString() },
        { onConflict: "phone" },
      );
      actions.push(`tags:${button.tags.join(",")}`);
    } catch (e) {
      console.error("[igbtn] erro ao aplicar tags:", e);
    }
  }

  const pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN");

  // ── Mensagem de retorno opcional ──
  if (button.reply_message && pageAccessToken) {
    try {
      const res = await fetch(`https://graph.instagram.com/v25.0/me/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${pageAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: fromId },
          message: { text: button.reply_message },
          messaging_type: "RESPONSE",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        actions.push("reply_message");
        await supabase.from("whatsapp_messages").insert({
          phone: fromId,
          message: button.reply_message,
          direction: "outgoing",
          message_id: data.message_id || null,
          status: "sent",
          media_type: "text",
          is_group: false,
          channel: "instagram",
          sender_name: username,
        });
      } else {
        console.error("[igbtn] falha ao enviar reply_message:", data);
      }
    } catch (e) {
      console.error("[igbtn] erro reply_message:", e);
    }
  }

  // ── Disparar fluxo de automação opcional ──
  if (button.flow_id) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      await fetch(`${supabaseUrl}/functions/v1/automation-trigger-incoming`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: fromId,
          message: button.label,
          flow_id: button.flow_id,
          source: "instagram_comment_button",
          metadata: { rule_id: ruleId, button_index: buttonIdx, username },
        }),
      });
      actions.push(`flow:${button.flow_id}`);
    } catch (e) {
      console.error("[igbtn] erro ao disparar fluxo:", e);
    }
  }

  console.log(`[igbtn] postback tratado (regra ${(rule as any).name}, botão ${buttonIdx}): ${actions.join(", ")}`);
  return { handled: true, actions };
}


