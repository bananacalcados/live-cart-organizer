// Treino do agente de suporte: roda triagem + agente sobre conversas reais SÓ PARA REVISÃO.
// Nunca envia mensagem, nunca move conversa, nunca cria link. Chamado pelo banco (x-cron-secret).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { type CallLog, finalDecision, runAgent, runTriage, sanitizeText, shouldRouteSupport, triageIgnores } from "../_shared/support-ai.ts";
import { buildSupportContext } from "../_shared/support-context.ts";
import { humanRepliedRecently } from "../_shared/support-policy.ts";
import { budgetGateway } from "../_shared/support-budget-gateway.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(withAccessLog("support-ai-training", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(cors);
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "configuracao_indisponivel" }, 500);
  const sb = createClient(url, key);
  const { run_id, batch, replay, round } = await req.json().catch(() => ({}));
  if (typeof run_id !== "string" || !/^[0-9a-f-]{36}$/i.test(run_id) || (replay !== undefined && typeof replay !== "boolean") || (round !== undefined && round !== 3) || (batch !== undefined && (!Number.isInteger(batch) || batch < 1 || batch > 2))) return json({ error: "parametros_invalidos" }, 400);
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "sem_chave_ia" }, 500);
  const { data: st } = await sb.from("support_settings").select("*").limit(1).maybeSingle();
  const { data: script } = await sb.from("support_agent_scripts").select("version,body").order("version", { ascending: false }).limit(1).maybeSingle();
  const cfg = { apiKey, baseURL: "https://ai.gateway.lovable.dev/v1", timeoutMs: st?.ai_timeout_ms ?? 30000 };
  // Um item por chamada: o limite de CPU da função não comporta várias conversas seguidas.
  let done = 0;
  {
    const { data: items, error } = await (round === 3 ? sb.rpc("support_training_replay3_claim", { p_run: run_id, p_n: Math.min(Number(batch) || 1, 2) }) : sb.rpc(replay ? "support_training_replay_claim" : "support_training_claim", { p_run: run_id, p_n: Math.min(Number(batch) || 1, 2) }));
    if (error) return json({ error: error.message }, 500);
    if (!items?.length) return json({ ok: true, done: 0, empty: true });
    await Promise.all(items.map(async (it: any) => {
      const logs: CallLog[] = [];
      const log = (c: CallLog) => logs.push(c);
      const tok = () => ({ tokens_in: logs.reduce((a, c) => a + (c.inTok ?? 0), 0), tokens_out: logs.reduce((a, c) => a + (c.outTok ?? 0), 0) });
      const save = (value: Record<string, unknown>) => sb.from("support_training_items").update(round === 3 ? { replay3_status: value.status, replay3_result: { ...value, script_version: script?.version, round: 3 } } : replay ? { replay_status: value.status, replay_result: { ...value, script_version: script?.version } } : value).eq("id", it.id);
      try {
        const ctx = await buildSupportContext(sb, it, { shareLastEvent: false, until: it.last_incoming_at ?? undefined });
        const conversation = ctx.conv.map((m) => ({ ...m, text: sanitizeText(m.text) }));
        if (!ctx.conv.some((m) => m.from === "cliente")) {
          await save({ status: "erro", error: "sem_texto_da_cliente", conversation, processed_at: new Date().toISOString() });
          return;
        }
        const at = Date.parse(it.last_incoming_at ?? new Date().toISOString());
        const human_recent_2h = humanRepliedRecently(ctx.conv, at);
        // Uma sugestão por cliente: se outra conversa dela no treino está no número mais ativo, esta só aponta para lá.
        // Também vale quando a outra conversa dela é mais recente (o histórico desta para antes dela).
        if (round === 3 && it.channel !== "instagram") {
          const s8 = String(it.phone).replace(/\D/g, "").slice(-8);
          const { data: sibs } = await sb.from("support_training_items").select("id,instance_name,whatsapp_number_id,last_incoming_at").eq("run_id", run_id).eq("channel", "whatsapp").neq("id", it.id).like("phone", `%${s8}`).not("replay_status", "is", null).limit(5);
          const sib = (sibs ?? []).find((x: any) => String(x.last_incoming_at) > String(it.last_incoming_at ?? "") || (String(x.last_incoming_at) === String(it.last_incoming_at ?? "") && x.id > it.id));
          if (sib) { await save({ status: "ok", conversation, customer_name: ctx.nome, decision: "outra_instancia", reason: "sugestao_unica_no_numero_mais_ativo", primary_item: sib.id, primary_label: sib.instance_name, human_recent_2h, other_instances: ctx.otherInstances, tokens_in: 0, tokens_out: 0, processed_at: new Date().toISOString() }); return; }
        }
        const meta = { id: it.id, phone: it.phone, number: it.whatsapp_number_id };
        const triage = await runTriage({ ...cfg, guardedFetch: budgetGateway(sb, meta, "triagem") }, st.ai_triage_model, ctx.conv, ctx.orders, log);
        ctx.configure(triage.facts ?? {}, triage.categoria);
        const base = { conversation, orders_ctx: ctx.orders, customer_name: ctx.nome, triage, triage_category: triage.categoria,
          triage_confidence: triage.confianca, is_support: !triageIgnores(triage.categoria), human_recent_2h };
        if (triageIgnores(triage.categoria)) {
          await save({ ...base, ...tok(), status: "ok", would_route_support: false, processed_at: new Date().toISOString() });
          return;
        }
        const outcome = await runAgent({ ...cfg, guardedFetch: budgetGateway(sb, meta, "agente") }, st.ai_agent_model, script?.body ?? "", ctx.nome, triage, ctx.conv,
          { ...ctx.deps, offersAlreadyMade: 0, maxOffers: st.max_offer_attempts ?? 1, now: at, supportPhone: st.support_whatsapp_phone ?? null,
            instagram: it.channel === 'instagram', instagramHandle: ctx.instagramHandle }, log);
        const dec = finalDecision(outcome, ctx.orders);
        await save({
          ...base, ...tok(), status: "ok", review_group: "suporte", agent_text: outcome.text, agent_actions: outcome.actions,
          decision: dec.decision, reason: dec.reason, handoff_summary: outcome.handoff?.resumo ?? null,
          would_route_support: !outcome.resolved && shouldRouteSupport(triage.categoria, !!outcome.handoff),
          prazo_por_envio: !!outcome.prazoPorEnvio, silent_handoff: !!outcome.handoff && !outcome.text,
          tracking_info: outcome.tracking ? { pedido: outcome.tracking.ref, ...outcome.tracking.info } : null,
          link_type: outcome.link?.tipo ?? null, other_instances: ctx.otherInstances, consolidation_target: outcome.consolidation ?? null, cpf_different_phone: outcome.cpfDifferentPhone ?? false,
          processed_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("support-ai-training item", it.id, String((e as Error)?.message || e).slice(0, 200));
        await save({ ...tok(), status: "erro", error: "falha_no_processamento", processed_at: new Date().toISOString() });
      }
      done++;
    }));
  }
  return json({ ok: true, done });
}));
