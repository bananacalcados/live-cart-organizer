import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Target {
  comment_id: string;
  username: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN");
    if (!pageAccessToken) {
      return new Response(
        JSON.stringify({ error: "META_PAGE_ACCESS_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { event_id, targets, message_template, sent_by } = body as {
      event_id: string;
      targets: Target[];
      message_template: string;
      sent_by?: string;
    };

    if (!event_id || !Array.isArray(targets) || targets.length === 0 || !message_template) {
      return new Response(
        JSON.stringify({ error: "event_id, targets[] and message_template are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Array<{ comment_id: string; username: string; status: string; error?: string }> = [];
    let sent = 0;
    let failed = 0;

    for (const target of targets) {
      const usernameClean = (target.username || "").replace(/^@/, "");
      const personalizedMsg = message_template.replace(/\{username\}/g, usernameClean);

      try {
        const res = await fetch(
          `https://graph.instagram.com/v25.0/me/messages`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${pageAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              recipient: { comment_id: target.comment_id },
              message: { text: personalizedMsg },
            }),
          }
        );

        const data = await res.json();

        if (res.ok) {
          sent++;
          await supabase.from("live_comment_dms").insert({
            event_id,
            comment_id: target.comment_id,
            username: target.username,
            message: personalizedMsg,
            status: "sent",
            meta_message_id: data.message_id || null,
            sent_by: sent_by || null,
          });
          results.push({ comment_id: target.comment_id, username: target.username, status: "sent" });
        } else {
          failed++;
          const errMsg = JSON.stringify(data).slice(0, 500);
          await supabase.from("live_comment_dms").insert({
            event_id,
            comment_id: target.comment_id,
            username: target.username,
            message: personalizedMsg,
            status: "error",
            error_details: errMsg,
            sent_by: sent_by || null,
          });
          results.push({ comment_id: target.comment_id, username: target.username, status: "error", error: errMsg });
        }
      } catch (e) {
        failed++;
        results.push({
          comment_id: target.comment_id,
          username: target.username,
          status: "error",
          error: e instanceof Error ? e.message : "unknown error",
        });
      }

      // Throttle: 400ms entre envios pra não estourar rate limit do IG
      await new Promise((r) => setTimeout(r, 400));
    }

    return new Response(
      JSON.stringify({ ok: true, total: targets.length, sent, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("instagram-send-bulk-dm error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
