// Telegram Financial Agent — webhook receiver
// Stage 3a: whitelist + /start invite token + audit. Attachment processing comes next.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function deriveWebhookSecret(token: string): Promise<string> {
  const data = new TextEncoder().encode(`telegram-financial:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...extra, text }),
  });
  if (!res.ok) console.error("[telegram] sendMessage failed", res.status, await res.text());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expected = await deriveWebhookSecret(TELEGRAM_BOT_TOKEN);
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (!safeEqual(got, expected)) {
    console.warn("[telegram] invalid secret token");
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const update = await req.json();
  const msg = update.message ?? update.edited_message;
  const chatId: number | undefined = msg?.chat?.id;
  if (!chatId) return new Response(JSON.stringify({ ok: true, ignored: true }));

  const text: string = (msg.text ?? msg.caption ?? "").trim();
  const fromName = `${msg.from?.first_name ?? ""} ${msg.from?.last_name ?? ""}`.trim() || msg.from?.username || "?";

  // Audit incoming
  await supabase.from("financial_agent_audit").insert({
    chat_id: String(chatId),
    direction: "in",
    action: msg.photo ? "photo" : msg.document ? "document" : msg.voice ? "voice" : "text",
    message: text || null,
    metadata: { from: fromName, message_id: msg.message_id },
  });

  // Whitelist check
  const { data: authUser } = await supabase
    .from("financial_agent_authorized_users")
    .select("id, display_name, active")
    .eq("chat_id", String(chatId))
    .eq("active", true)
    .maybeSingle();

  // /start <token> — onboarding
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const token = parts[1];
    if (authUser) {
      await sendMessage(chatId, `✅ Você já está autorizado, ${authUser.display_name}. Envie comprovantes, extratos (XLSX/OFX/CSV) ou /help.`);
      return new Response(JSON.stringify({ ok: true }));
    }
    if (!token) {
      await sendMessage(chatId, "🔒 Acesso restrito. Use <code>/start &lt;token&gt;</code> com um token de convite gerado no painel.");
      return new Response(JSON.stringify({ ok: true }));
    }
    const { data: invite } = await supabase
      .from("financial_agent_invite_tokens")
      .select("id, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();
    if (!invite || invite.used_at || new Date(invite.expires_at).getTime() < Date.now()) {
      await sendMessage(chatId, "❌ Token inválido ou expirado.");
      return new Response(JSON.stringify({ ok: true }));
    }
    await supabase.from("financial_agent_authorized_users").insert({
      chat_id: String(chatId),
      display_name: fromName,
      role: "admin",
      active: true,
    });
    await supabase.from("financial_agent_invite_tokens").update({
      used_at: new Date().toISOString(),
      used_by_chat_id: String(chatId),
    }).eq("id", invite.id);
    await sendMessage(chatId, `✅ Cadastrado, ${fromName}! Pode mandar comprovantes/extratos a qualquer momento.`);
    return new Response(JSON.stringify({ ok: true }));
  }

  if (!authUser) {
    await sendMessage(chatId, "🔒 Acesso negado. Solicite um token de convite ao administrador.");
    return new Response(JSON.stringify({ ok: true }));
  }

  // Help
  if (text === "/help" || text === "/start") {
    await sendMessage(chatId,
      "<b>Agente Financeiro</b>\n" +
      "• Envie foto/PDF de comprovante → categorizo e lanço\n" +
      "• Envie XLSX/OFX/CSV → importo e concilio\n" +
      "• /pendentes — lançamentos aguardando revisão\n" +
      "• /resumo — fluxo de caixa do dia",
    );
    return new Response(JSON.stringify({ ok: true }));
  }

  // Placeholder for next stage (parsers + AI categorization)
  if (msg.photo || msg.document) {
    await sendMessage(chatId, "📥 Anexo recebido. Processamento automático será ativado em breve (estou em construção).");
  } else if (text) {
    await sendMessage(chatId, "Comando não reconhecido. Use /help.");
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
