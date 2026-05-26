// Telegram Financial Agent — admin tools (register webhook, generate invite token)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function deriveWebhookSecret(token: string): Promise<string> {
  const data = new TextEncoder().encode(`telegram-financial:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: require logged-in admin
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
  if (!(roles || []).some((r: any) => r.role === "admin")) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  try {
    if (action === "register_webhook") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-financial-webhook`;
      const secret = await deriveWebhookSecret(TELEGRAM_BOT_TOKEN);
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: secret,
          allowed_updates: ["message", "edited_message"],
          drop_pending_updates: true,
        }),
      });
      const json = await res.json();
      return new Response(JSON.stringify({ ok: json.ok, webhook_url: webhookUrl, telegram: json }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "webhook_info") {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
      const json = await res.json();
      const me = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`)).json();
      return new Response(JSON.stringify({ webhook: json.result, bot: me.result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create_invite") {
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { data, error } = await admin.from("financial_agent_invite_tokens").insert({
        token, created_by: user.id, expires_at: expires,
      }).select().single();
      if (error) throw error;
      const me = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`)).json();
      const botUsername = me?.result?.username;
      return new Response(JSON.stringify({
        token: data.token,
        expires_at: data.expires_at,
        deep_link: botUsername ? `https://t.me/${botUsername}?start=${data.token}` : null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
