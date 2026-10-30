// Envio de e-mail ÚNICO do sistema (Resend). Toda chamada ao Resend passa por aqui
// e todo envio (sucesso ou erro) é gravado em email_send_log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type EmailCategory = "fiscal" | "transacional" | "marketing";

export interface EmailAttachment { filename: string; content_base64: string }

export interface SendEmailInput {
  categoria: EmailCategory;
  from?: { email: string; name?: string };
  to: string[];
  cc?: string[];
  reply_to?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  company_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SendEmailResult { ok: boolean; log_id: string | null; provider_message_id?: string; error?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const sb = adminClient();
  const to = [...new Set((input.to || []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const cc = [...new Set((input.cc || []).map((e) => e.trim().toLowerCase()).filter((e) => e && !to.includes(e)))];

  let from = input.from;
  let replyTo = input.reply_to;
  if (!from || !replyTo) {
    const { data: cfg } = await sb.from("email_settings").select("from_email, from_name, reply_to").eq("category", input.categoria).maybeSingle();
    if (!from && cfg) from = { email: cfg.from_email, name: cfg.from_name };
    if (!replyTo && cfg?.reply_to) replyTo = cfg.reply_to;
  }

  const { data: log } = await sb.from("email_send_log").insert({
    categoria: input.categoria, company_id: input.company_id ?? null, to, cc,
    subject: input.subject, status: "queued",
    metadata: { ...(input.metadata || {}), attachments: (input.attachments || []).map((a) => a.filename) },
  }).select("id").single();
  const logId = log?.id ?? null;

  const fail = async (error: string): Promise<SendEmailResult> => {
    if (logId) await sb.from("email_send_log").update({ status: "failed", error: error.slice(0, 2000) }).eq("id", logId);
    return { ok: false, log_id: logId, error };
  };

  if (!from) return fail(`Remetente não configurado para a categoria ${input.categoria}`);
  if (!to.length) return fail("Nenhum destinatário");
  const bad = [...to, ...cc, ...(replyTo ? [replyTo] : [])].filter((e) => !EMAIL_RE.test(e));
  if (bad.length) return fail(`E-mail inválido: ${bad.join(", ")}`);
  if (!input.html && !input.text) return fail("Corpo do e-mail vazio");

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return fail("RESEND_API_KEY não configurado");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: from.name ? `${from.name} <${from.email}>` : from.email,
        to, cc: cc.length ? cc : undefined, reply_to: replyTo || undefined,
        subject: input.subject, html: input.html, text: input.text,
        attachments: input.attachments?.length
          ? input.attachments.map((a) => ({ filename: a.filename, content: a.content_base64 }))
          : undefined,
      }),
    });
    const body = await res.text();
    if (!res.ok) return fail(`Resend [${res.status}]: ${body}`);
    let id: string | undefined;
    try { id = JSON.parse(body)?.id; } catch { /* ignore */ }
    if (logId) await sb.from("email_send_log").update({ status: "sent", provider_message_id: id ?? null }).eq("id", logId);
    return { ok: true, log_id: logId, provider_message_id: id };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Retorna o id do usuário se for admin (JWT), ou "service" para service role. */
export async function requireAdminOrService(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return "service";
  const sb = adminClient();
  const { data } = await sb.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: uid, _role: "admin" });
  return isAdmin ? uid : null;
}
