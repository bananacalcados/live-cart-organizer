// Triagem + agente de suporte. Em modo automático, a decisão validada entra na fila protegida.
// Chamado pelo banco (x-cron-secret) quando chega mensagem de suporte numa instância marcada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import {
  type CallLog, finalDecision, parseTriageOutput, runAgent, runTriage, shouldRouteSupport, triageIgnores, triageToIntent,
} from "../_shared/support-ai.ts";
import { buildSupportContext } from "../_shared/support-context.ts";
import { primaryInstance } from "../_shared/support-policy.ts";
import { budgetGateway } from "../_shared/support-budget-gateway.ts";
import { hasPendingCustomerRequest, humanRepliedRecently } from "../_shared/support-policy.ts";
import { runSupportAiWithRetry, type SupportAiAttempt } from "../_shared/support-ai-retry.ts";
import { returnFlowContinuation, type ReturnFlowContext } from "../_shared/support-return-flow.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function loadReturnFlow(sb: any, s: any): Promise<ReturnFlowContext | null> {
  const { data } = await sb.from("support_auto_suggestions").select("return_flow_state,return_flow_reason,return_flow_pending_link")
    .eq("phone", s.phone).eq("channel", s.channel).eq("status", "enviada")
    .eq("whatsapp_number_id", s.whatsapp_number_id).lt("created_at", s.created_at)
    .gte("created_at", new Date(Date.parse(s.created_at) - 864e5).toISOString())
    .not("return_flow_state", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const flow = data?.return_flow_state ? { state: data.return_flow_state, reason: data.return_flow_reason, pendingLink: data.return_flow_pending_link } : null;
  return returnFlowContinuation(flow) ? flow : null;
}

Deno.serve(withAccessLog("support-ai-agent", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(cors);
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "configuracao_indisponivel" }, 500);
  const sb = createClient(url, serviceKey);
  const body = await req.json().catch(() => ({}));
  const { suggestion_id } = body;
  const dryRun = body.dry_run === true;
  if (typeof suggestion_id !== "string" || !/^[0-9a-f-]{36}$/i.test(suggestion_id)) return json({ error: "suggestion_id" }, 400);

  const { data: s } = await sb.from("support_auto_suggestions").select("id,phone,whatsapp_number_id,channel,status,mode_at_creation,created_at,cost_due_at,cost_claimed_at,cost_prefilter_passed,incoming_text,triage,decision,reason,suggested_text,link_type,exchange_offered").eq("id", suggestion_id).maybeSingle();
  if (!s || (!dryRun && s.status !== "processando")) return json({ skipped: "not_pending" });
  const { data: st } = await sb.from("support_settings").select("*").limit(1).maybeSingle();
  if (!dryRun && (!['shadow','auto'].includes(st?.auto_reply_mode) || s.mode_at_creation !== st.auto_reply_mode || !(st.auto_reply_instance_ids ?? []).includes(s.whatsapp_number_id) || Date.parse(s.cost_due_at ?? "") > Date.now())) return json({ skipped: "queue_mode_guard" });
  const returnFlow = await loadReturnFlow(sb, s);
  const flowContinuation = returnFlowContinuation(returnFlow);
  if (!dryRun) {
    if (!s.cost_claimed_at) {
      const { data: claimed, error } = await sb.rpc("support_cost_claim_direct", { p_id: s.id });
      if (error || !claimed) return json({ skipped: "already_claimed_or_filtered" });
    } else if (!s.cost_prefilter_passed || !st.ai_silence_queue_enabled) return json({ skipped: "already_claimed" });
  }
  const fallback = async (err: string) => { await sb.rpc("support_ai_fallback", { p_id: s.id, p_error: err }); return json({ fallback: err }); };
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!st?.ai_enabled || !apiKey) return fallback(!apiKey ? "sem_chave_ia" : "ia_desligada");

  // Limite de custo por conversa/dia
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await sb.from("support_ai_calls").select("id", { count: "exact", head: true })
    .eq("phone", s.phone).eq("whatsapp_number_id", s.whatsapp_number_id).gte("created_at", since);
  if (!dryRun && (count ?? 0) + (flowContinuation ? 1 : 2) > (st.ai_max_calls_per_conversation_day ?? 8)) return fallback("limite_diario_ia");

  const logs: CallLog[] = [];
  const log = (c: CallLog) => logs.push(c);
  // Gateway middleware records every real HTTP call, including tool continuations, once.
  const flushLogs = () => Promise.resolve();

  const ctx = await buildSupportContext(sb, s, { shareLastEvent: !!st.tracking_share_last_event, allowReceiptSend: !dryRun, until: dryRun ? s.created_at : undefined });
  const { conv, orders, nome, saleIds } = ctx;
  if (humanRepliedRecently(conv, dryRun ? Date.parse(s.created_at) : Date.now())) {
    if (!dryRun) await sb.from("support_auto_suggestions").update({ status: "ignorada", reason: "humano_2h" }).eq("id", s.id).eq("status", "processando");
    return json({ ignored: "humano_2h", dry_run: dryRun });
  }

  // Uma sugestão por cliente: só no número onde a conversa de suporte dela está mais ativa (se esse número também é atendido).
  const primary = s.channel === "whatsapp" ? primaryInstance(conv) : null;
  if (primary && primary !== s.whatsapp_number_id && (st.auto_reply_instance_ids ?? []).includes(primary)) {
    if (!dryRun) await sb.from("support_auto_suggestions").update({ status: "ignorada", reason: "outra_instancia_mais_ativa" }).eq("id", s.id).eq("status", "processando");
    return json({ ignored: "outra_instancia_mais_ativa", dry_run: dryRun });
  }
  const cfg = { apiKey, baseURL: "https://ai.gateway.lovable.dev/v1", timeoutMs: st.ai_timeout_ms ?? 30000 };
  const recordAttempt = async (kind: "triagem" | "agente", attempt: SupportAiAttempt) => {
    const { error } = await sb.rpc("support_ai_attempt_log", {
      p_suggestion: s.id, p_kind: kind, p_attempt: attempt.attempt, p_model: attempt.model,
      p_ok: attempt.ok, p_error: attempt.error ?? null, p_duration: attempt.durationMs,
    });
    if (error) console.error("support-ai-attempt-log", error.message);
  };
  try {
    const meta = { id: s.id, phone: s.phone, number: s.whatsapp_number_id };
    const simulatedTriage = dryRun && !s.triage && /devol/i.test(s.incoming_text ?? "");
    const triage = dryRun && s.triage ? parseTriageOutput(s.triage) : simulatedTriage ? {
      categoria: "devolucao" as const, confianca: 0, justificativa: "triagem determinística somente para simulação", motivo_tamanho: false, facts: {},
    } : await runSupportAiWithRetry({
      primaryModel: st.ai_triage_model,
      alternateModel: st.ai_agent_model,
      run: (model) => runTriage({ ...cfg, guardedFetch: budgetGateway(sb, meta, "triagem") }, model, conv, orders, log),
      onAttempt: (attempt) => dryRun ? undefined : recordAttempt("triagem", attempt),
    });
    ctx.configure(triage.facts ?? {}, triage.categoria);
    const base = { triage, triage_category: triage.categoria, triage_confidence: triage.confianca, intent: triageToIntent(triage.categoria) };
    if (triageIgnores(triage.categoria) && !flowContinuation) {
      await flushLogs();
      if (!dryRun) await sb.from("support_auto_suggestions").update({ ...base, ai_status: "ok", status: "ignorada", reason: "triagem_" + triage.categoria })
        .eq("id", s.id).eq("status", "processando");
      return json({ ignored: triage.categoria, dry_run: dryRun });
    }

    const { data: script } = await sb.from("support_agent_scripts").select("version,body").order("version", { ascending: false }).limit(1).maybeSingle();
    const { count: offers } = await sb.from("support_auto_suggestions").select("id", { count: "exact", head: true })
      .eq("phone", s.phone).eq("whatsapp_number_id", s.whatsapp_number_id).eq("exchange_offered", true)
      .in("status", ["enviada"]).lt("created_at", s.created_at).gte("created_at", new Date(Date.parse(s.created_at) - 30 * 864e5).toISOString());

    let agentModelCalled = false;
    const outcome = await runSupportAiWithRetry({
      primaryModel: st.ai_agent_model,
      alternateModel: st.ai_triage_model,
      run: (model) => runAgent({ ...cfg, guardedFetch: budgetGateway(sb, meta, "agente") }, model, script?.body ?? "", nome, triage, conv, {
        ...ctx.deps, offersAlreadyMade: offers ?? 0, maxOffers: st.max_offer_attempts ?? 1, supportPhone: st.support_whatsapp_phone ?? null,
        returnFlow, now: dryRun ? Date.parse(s.created_at) : Date.now(),
      }, log, () => { agentModelCalled = true; }),
      onAttempt: (attempt) => !dryRun && agentModelCalled ? recordAttempt("agente", attempt) : undefined,
    });

    const dec = finalDecision(outcome, orders);
    if (dryRun) {
      await flushLogs();
      return json({
        dry_run: true, id: s.id, simulated_triage: simulatedTriage,
        before: { decision: s.decision, reason: s.reason, text: s.suggested_text, link_type: s.link_type, exchange_offered: s.exchange_offered },
        after: { decision: dec.decision, reason: dec.reason, text: outcome.text, link_type: outcome.link?.tipo ?? null,
          return_flow_state: outcome.returnFlowState ?? null, return_flow_reason: outcome.returnFlowReason ?? null,
          return_flow_pending_link: outcome.returnFlowPendingLink ?? null, handoff: outcome.handoff ?? null },
      });
    }
    if (outcome.resolved) {
      await flushLogs();
      await sb.from("support_auto_suggestions").update({ ...base, ai_status: "ok", status: "ignorada", decision: "nada", reason: dec.reason }).eq("id", s.id).eq("status", "processando");
      return json({ ignored: "caso_ja_resolvido" });
    }
    const linkSale = outcome.link ? saleIds.get(outcome.link.ref) : null;
    const linkRef = outcome.link?.ref;
    const linkOrder = linkRef ? orders.find((o) => o.ref === linkRef) : null;
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
      prazo_por_envio: !!outcome.prazoPorEnvio,
      tracking_info: outcome.tracking ? { pedido: outcome.tracking.ref, ...outcome.tracking.info } : null,
      other_instances: ctx.otherInstances, consolidation_target: outcome.consolidation ?? null,
      cpf_different_phone: outcome.cpfDifferentPhone ?? false,
      return_flow_state: outcome.returnFlowState ?? null,
      return_flow_reason: outcome.returnFlowReason ?? null,
      return_flow_pending_link: outcome.returnFlowPendingLink ?? null,
      return_flow_continuation: flowContinuation,
    }).eq("id", s.id).eq("status", "processando");
    // Linha SUPORTE e envio real só passam pelas travas do banco no modo automático.
    if (st.auto_reply_mode === 'auto') {
      await sb.rpc('support_auto_route', { p_id: s.id });
      const { data: queued, error: queueError } = await sb.rpc('support_suggestion_auto_enqueue', { p_id: s.id });
      if (queueError) return json({ ok: true, decision: dec.decision, queue_error: queueError.message });
      return json({ ok: true, decision: dec.decision, queued });
    }
    return json({ ok: true, decision: dec.decision });
  } catch (e) {
    await flushLogs();
    const msg = String((e as Error)?.message || e);
    if (dryRun) return json({ dry_run: true, id: s.id, error: msg.slice(0, 300) }, 200);
    if (/No output generated|triagem_vazia_ou_invalida/i.test(msg) && !hasPendingCustomerRequest(conv)) {
      await sb.from("support_auto_suggestions").update({
        ai_status: "ok", ai_error: null, status: "ignorada", decision: "nada",
        reason: "conversa_encerrada_sem_pedido", suggested_text: null, handoff_summary: null,
        would_route_support: false, auto_send_after: null,
      }).eq("id", s.id).eq("status", "processando");
      return json({ ignored: "conversa_encerrada_sem_pedido" });
    }
    console.error("support-ai-agent", msg);
    return fallback(msg.slice(0, 300));
  }
}));
