// Página pública de candidatura (/vaga/:codigo). Sem login; tudo validado aqui e gravado por
// funções SQL service-only. Nunca devolve dados de outro candidato: só o rascunho do próprio link.
// Limite por ação (rh_public_hit): open/submit 60/h por IP; draft 400/h por código; 600/h por código (open+draft); submit só conta submit. A nota NÃO é calculada aqui (fase 3).
import { createClient } from "npm:@supabase/supabase-js@2";
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { accessMetadata } from "../_shared/access-log-data.ts";
import { internalCallHeaders } from "../_shared/requireAuth.ts";
import { validateRhSubmission } from "./validate.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const CODE = /^[a-z0-9]{10,20}$/;

/** Disparo assíncrono; candidato não aguarda a IA. Sem retries automáticos. */
async function queueEvaluation(candidatoId: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return;
  const headers = await internalCallHeaders();
  await fetch(`${url}/functions/v1/rh-score`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ candidato_id: candidatoId }) });
}

Deno.serve(withAccessLog("rh-public", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = String(body?.action || "");
  const code = String(body?.code || "").trim().toLowerCase();
  if (!["open", "draft", "submit"].includes(action) || !CODE.test(code)) return json({ error: "invalid" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = accessMetadata(req).ip ?? null;
  const { data: allowed, error: hitErr } = await sb.rpc("rh_public_hit", { p_ip: ip, p_code: code, p_action: action });
  if (hitErr) return json({ error: "unavailable" }, 503);
  if (!allowed) return json({ error: "rate_limited", message: "Estamos com muitos acessos. Tente de novo em 1 minuto." }, 429);

  if (action === "open") {
    const { data, error } = await sb.rpc("rh_public_open", { p_code: code });
    if (error) return json({ error: "unavailable" }, 503);
    if (!data?.found) return json({ error: "not_found" }, 404);
    return json(data);
  }

  if (action === "draft") {
    const draft = body?.draft;
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) return json({ error: "invalid" }, 400);
    if (JSON.stringify(draft).length > 20000) return json({ error: "too_large" }, 413);
    const { data, error } = await sb.rpc("rh_public_draft", { p_code: code, p_draft: draft });
    if (error) return json({ error: "unavailable" }, 503);
    if (data === "not_found") return json({ error: "not_found" }, 404);
    return json({ ok: true, submitted: data === "submitted" });
  }

  // submit
  const { data: opened } = await sb.rpc("rh_public_open", { p_code: code });
  if (!opened?.found) return json({ error: "not_found" }, 404);
  if (opened.submitted) return json({ error: "submitted" }, 409);
  const ua = req.headers.get("user-agent") || "";
  const v = validateRhSubmission(body?.data, (opened.cenarios || []).map((c: any) => String(c.id)), ua);
  if (!v.ok) return json({ error: "validation", fields: v.errors }, 400);
  const { data, error } = await sb.rpc("rh_public_submit", { p_code: code, p_data: v.data });
  if (error) return json({ error: "unavailable" }, 503);
  if (!data?.ok) return json({ error: data?.error || "failed" }, data?.error === "submitted" ? 409 : 400);
  const evaluation = queueEvaluation(String(data.candidato_id)).catch(() => { console.error("rh evaluation dispatch unavailable"); });
  EdgeRuntime.waitUntil(evaluation);
  return json({ ok: true });
}));
