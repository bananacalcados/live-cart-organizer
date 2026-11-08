import { withAccessLog } from "../_shared/withAccessLog.ts";
// Ações da equipe na moderação: reexibir, "estava certo", responder dúvida e situação do contato.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuth } from "../_shared/requireAuth.ts";
import { resolveIgAccountByAccountId } from "../_shared/instagram-account.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(withAccessLog("ig-comment-moderation-action", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireAuth(req);
  if (denied) return denied;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  const userId = u?.user?.id;
  if (!userId) return json({ error: "sessão inválida" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "corpo inválido" }, 400); }
  const { id, action } = body || {};
  if (typeof id !== "string" || !["unhide", "confirm", "public_reply", "contact"].includes(action)) {
    return json({ error: "parâmetros inválidos" }, 400);
  }
  const { data: row } = await sb.from("ig_comment_moderation").select("*").eq("id", id).maybeSingle();
  if (!row) return json({ error: "não encontrado" }, 404);
  const now = new Date().toISOString();

  if (action === "confirm") {
    if (!row.hidden_at) return json({ error: "comentário não está oculto" }, 400);
    await sb.from("ig_comment_moderation").update({ review_verdict: "correct", reviewed_by: userId, reviewed_at: now }).eq("id", id);
    return json({ ok: true });
  }

  if (action === "contact") {
    const st = body.contact_status;
    if (!["a_contatar", "contatado", "resolvido"].includes(st)) return json({ error: "situação inválida" }, 400);
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : row.contact_note;
    await sb.from("ig_comment_moderation").update({ contact_status: st, contact_note: note }).eq("id", id);
    return json({ ok: true });
  }

  const acc = await resolveIgAccountByAccountId(sb, row.ig_account_id);
  if (action === "unhide") {
    if (!row.hidden_at || row.unhidden_at) return json({ error: "comentário não está oculto" }, 400);
    const r = await fetch(`https://graph.instagram.com/v25.0/${row.comment_id}?hide=false&access_token=${encodeURIComponent(acc.accessToken)}`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "Instagram recusou", status: r.status, details: b }, r.status);
    await sb.from("ig_comment_moderation").update({
      unhidden_at: now, unhidden_by: userId, review_verdict: "wrong", reviewed_by: userId, reviewed_at: now, status: "kept",
      contact_status: row.contact_status === "a_contatar" ? null : row.contact_status,
    }).eq("id", id);
    return json({ ok: true });
  }

  // public_reply
  const message = String(body.message || "").trim().slice(0, 2000);
  if (!message) return json({ error: "mensagem vazia" }, 400);
  if (row.public_reply_sent_at) return json({ error: "já respondido" }, 409);
  const r = await fetch(`https://graph.instagram.com/v25.0/${row.comment_id}/replies`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acc.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: "Instagram recusou", status: r.status, details: b }, r.status);
  await sb.from("ig_comment_moderation").update({ public_reply_sent_at: now, public_reply_by: userId, suggested_reply: message }).eq("id", id);
  return json({ ok: true });
}));
