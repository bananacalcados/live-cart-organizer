import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { action, commentId, message, recipientId } = body;

    if (!action) {
      return new Response(
        JSON.stringify({ error: "action is required (reply_comment, send_dm, private_reply)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result: Record<string, unknown> = {};

    if (action === "reply_comment") {
      // Reply publicly to a comment
      if (!commentId || !message) {
        return new Response(
          JSON.stringify({ error: "commentId and message are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await fetch(
        `https://graph.instagram.com/v25.0/${commentId}/replies`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${pageAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        console.error("Reply comment error:", data);
        return new Response(
          JSON.stringify({ error: "Failed to reply", details: data }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      result = { success: true, action: "reply_comment", commentId, replyId: data.id };
      console.log(`Replied to comment ${commentId}: ${message.slice(0, 50)}`);

    } else if (action === "private_reply") {
      // Send a private message to the person who commented
      if (!commentId || !message) {
        return new Response(
          JSON.stringify({ error: "commentId and message are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await fetch(
        `https://graph.instagram.com/v25.0/me/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${pageAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            message: { text: message },
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        console.error("Private reply error:", data);
        return new Response(
          JSON.stringify({ error: "Failed to send DM", details: data }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      result = { success: true, action: "private_reply", commentId, messageId: data.message_id };
      console.log(`Private reply sent for comment ${commentId}`);

    } else if (action === "send_dm") {
      // Send DM using recipientId (Instagram-scoped user ID)
      if (!recipientId || !message) {
        return new Response(
          JSON.stringify({ error: "recipientId and message are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await fetch(
        `https://graph.instagram.com/v25.0/me/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${pageAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: message },
            messaging_type: "RESPONSE",
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        console.error("Send DM error:", data);
        return new Response(
          JSON.stringify({ error: "Failed to send DM", details: data }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      result = { success: true, action: "send_dm", recipientId, messageId: data.message_id };
      console.log(`DM sent to ${recipientId}`);
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("instagram-comment-reply error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
