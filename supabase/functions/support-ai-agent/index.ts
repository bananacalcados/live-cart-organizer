// Fase 4b: triagem + agente de suporte por IA, SÓ EM MODO SOMBRA (nunca envia nada).
// Chamado pelo banco (x-cron-secret) quando chega mensagem de suporte numa instância marcada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import {
  type CallLog, finalDecision, runAgent, runTriage, shouldRouteSupport, triageIgnores, triageToIntent,
} from "../_shared/support-ai.ts";
import { buildSupportContext } from "../_shared/support-context.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(withAccessLog("support-ai-agent", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(cors);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { suggestion_id } = await req.json().catch(() => ({}));
  if (!suggestion_id) return json({ error: "suggestion_id" }, 400);

  const { data: s } = await sb.from("support_auto_suggestions").select("id,phone,whatsapp_number_id,channel,status,created_at").eq("id", suggestion_id).maybeSingle();
  if (!s || s.status !== "processando") return json({ skipped: "not_pending" });
  const { data: st } = await sb.from("support_settings").select("*").limit(1).maybeSingle();
  const fallback = async (err: string) => { await sb.rpc("support_ai_fallback", { p_id: s.id, p_error: err }); return json({ fallback: err }); };
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!st?.ai_enabled || !apiKey) return fallback(!apiKey ? "sem_chave_ia" : "ia_desligada");

  // Limite de custo por conversa/dia
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await sb.from("support_ai_calls").select("id", { count: "exact", head: true })
    .eq("phone", s.phone).eq("whatsapp_number_id", s.whatsapp_number_id).gte("created_at", since);
  if ((count ?? 0) + 2 > (st.ai_max_calls_per_conversation_day ?? 8)) return fallback("limite_diario_ia");

  const logs: CallLog[] = [];
  const log = (c: CallLog) => logs.push(c);
  const flushLogs = () => logs.length ? sb.from("support_ai_calls").insert(logs.map((c) => ({
    suggestion_id: s.id, phone: s.phone, whatsapp_number_id: s.whatsapp_number_id, kind: c.kind, model: c.model, ok: c.ok,
    error: c.error ?? null, duration_ms: c.ms, input_tokens: c.inTok ?? null, output_tokens: c.outTok ?? null,
  }))) : Promise.resolve();

  const ctx = await buildSupportContext(sb, s, { shareLastEvent: !!st.tracking_share_last_event });
  const { conv, orders, nome, saleIds } = ctx;

  const cfg = { apiKey, baseURL: "https://ai.gateway.lovable.dev/v1", timeoutMs: st.ai_timeout_ms ?? 30000 };
  try {
    const triage = await runTriage(cfg, st.ai_triage_model, conv, orders, log);
    const base = { triage, triage_category: triage.categoria, triage_confidence: triage.confianca, intent: triageToIntent(triage.categoria) };
    if (triageIgnores(triage.categoria)) {
      await flushLogs();
      await sb.from("support_auto_suggestions").update({ ...base, ai_status: "ok", status: "ignorada", reason: "triagem_" + triage.categoria })
        .eq("id", s.id).eq("status", "processando");
      return json({ ignored: triage.categoria });
    }

    const { data: script } = await sb.from("support_agent_scripts").select("version,body").order("version", { ascending: false }).limit(1).maybeSingle();
    const { count: offers } = await sb.from("support_auto_suggestions").select("id", { count: "exact", head: true })
      .eq("phone", s.phone).eq("whatsapp_number_id", s.whatsapp_number_id).eq("exchange_offered", true)
      .in("status", ["enviada"]).gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString());

    const outcome = await runAgent(cfg, st.ai_agent_model, script?.body ?? "", nome, triage, conv, {
      ...ctx.deps, offersAlreadyMade: offers ?? 0, maxOffers: st.max_offer_attempts ?? 1,
    }, log);

    const dec = finalDecision(outcome, orders);
    const linkSale = outcome.link ? saleIds.get(outcome.link.ref) : null;
    const linkOrder = outcome.link ? orders.find((o) => o.ref === outcome.link!.ref) : null;
    await flushLogs();
    await sb.from("support_auto_suggestions").update({
      ...base,
      intent: outcome.link ? outcome.link.tipo : base.intent,
      ai_status: "ok", status: "nova", decision: dec.decision, reason: dec.reason,
      suggested_text: outcome.text, agent_actions: outcome.actions, exchange_offered: outcome.exchangeOffered,
      handoff_summary: outcome.handoff?.resumo ?? null, script_version: script?.version ?? null,
      sale_id: linkSale ?? (orders.length === 1 ? saleIds.get("P1") : null), sale_channel: linkOrder ? "online" : null,
      link_type: outcome.link?.tipo ?? null, customer_name: nome,
      would_route_support: shouldRouteSupport(triage.categoria, !!outcome.handoff),
      tracking_info: outcome.tracking ? { pedido: outcome.tracking.ref, ...outcome.tracking.info } : null,
    }).eq("id", s.id).eq("status", "processando");
    // Linha SUPORTE: só move sozinho com o interruptor ligado e modo automático (checado no banco).
    await sb.rpc("support_auto_route", { p_id: s.id });
    return json({ ok: true, decision: dec.decision });
  } catch (e) {
    await flushLogs();
    const msg = String((e as Error)?.message || e);
    console.error("support-ai-agent", msg);
    return fallback(msg.slice(0, 300));
  }
}));
