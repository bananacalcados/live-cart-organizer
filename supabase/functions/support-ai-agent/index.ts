// Fase 4b: triagem + agente de suporte por IA, SÓ EM MODO SOMBRA (nunca envia nada).
// Chamado pelo banco (x-cron-secret) quando chega mensagem de suporte numa instância marcada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import {
  type CallLog, type ConvMessage, finalDecision, firstName, type OrderCtx, runAgent, runTriage, triageIgnores, triageToIntent,
} from "../_shared/support-ai.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ONLINE = ["site", "live", "link_online", "whatsapp"];

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

  // Conversa (últimas 12 mensagens de texto)
  const { data: msgs } = await sb.from("whatsapp_messages").select("message,direction,created_at")
    .eq("phone", s.phone).eq("whatsapp_number_id", s.whatsapp_number_id).lte("created_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(12);
  const conv: ConvMessage[] = (msgs ?? []).filter((m) => m.message).reverse()
    .map((m) => ({ from: m.direction === "incoming" ? "cliente" : "loja", text: m.message, at: m.created_at }));

  // Pedidos pagos dos últimos 60 dias pelo final do telefone (sem CPF, endereço ou telefone)
  const s8 = String(s.phone || "").replace(/\D/g, "").slice(-8);
  const saleIds = new Map<string, string>(); const itemSku = new Map<string, string | null>();
  let orders: OrderCtx[] = []; let nome: string | null = null;
  if (s.channel !== "instagram" && s8.length === 8) {
    const { data: sales } = await sb.from("pos_sales").select("id,created_at,sales_channel,status,customer_name,status_cancelamento")
      .eq("phone_suffix8", s8).gte("created_at", new Date(Date.now() - 60 * 864e5).toISOString())
      .in("status", ["completed", "paid"]).order("created_at", { ascending: false }).limit(5);
    const valid = (sales ?? []).filter((x) => String(x.status_cancelamento ?? "") !== "cancelado");
    const ids = valid.map((x) => x.id);
    const [{ data: items }, { data: sims }] = await Promise.all([
      ids.length ? sb.from("pos_sale_items").select("sale_id,product_name,size,variant_name,quantity,sku").in("sale_id", ids) : Promise.resolve({ data: [] as any[] }),
      ids.length ? sb.from("shipment_simulations").select("sale_id,delivered_at,created_at").in("sale_id", ids).is("merged_into_id", null) : Promise.resolve({ data: [] as any[] }),
    ]);
    nome = firstName(valid[0]?.customer_name);
    orders = valid.map((x, i) => {
      const ref = `P${i + 1}`; saleIds.set(ref, x.id);
      const its = (items ?? []).filter((it: any) => it.sale_id === x.id).map((it: any, j: number) => {
        itemSku.set(`${ref}:I${j + 1}`, it.sku ?? null);
        return { item: `I${j + 1}`, produto: it.product_name, tamanho: it.size ?? it.variant_name ?? null, quantidade: it.quantity };
      });
      const sim = (sims ?? []).filter((z: any) => z.sale_id === x.id).sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))[0];
      return { ref, data: x.created_at.slice(0, 10), canal: ONLINE.includes(x.sales_channel) ? "online" : "loja", status: x.status,
        entregue_em: sim?.delivered_at?.slice(0, 10) ?? null, itens: its } as OrderCtx;
    });
  }

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
      orders,
      offersAlreadyMade: offers ?? 0,
      maxOffers: st.max_offer_attempts ?? 1,
      checkEligibility: async (ref, tipo) => {
        const { data, error } = await sb.rpc("check_exchange_eligibility", { p_order_ref: saleIds.get(ref)!, p_request_type: tipo });
        if (error) return { elegivel: "needs_human", motivo: "erro_consulta", prazo_ate: null };
        return { elegivel: data?.eligible ?? "needs_human", motivo: data?.reason ?? "", prazo_ate: data?.deadline_at ? String(data.deadline_at).slice(0, 10) : null };
      },
      sizesInStock: async (ref, item) => {
        const sku = itemSku.get(`${ref}:${item}`);
        if (!sku) return { erro: "item_sem_codigo" };
        const { data: p } = await sb.from("pos_products").select("parent_sku").eq("sku", sku).not("parent_sku", "is", null).limit(1).maybeSingle();
        if (!p?.parent_sku) return { erro: "produto_sem_grade" };
        const { data: vs } = await sb.from("pos_products").select("size,stock").eq("parent_sku", p.parent_sku).gt("stock", 0).limit(200);
        const tamanhos = [...new Set((vs ?? []).map((v: any) => String(v.size ?? "").trim()).filter(Boolean))].sort();
        return { tamanhos };
      },
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
    }).eq("id", s.id).eq("status", "processando");
    return json({ ok: true, decision: dec.decision });
  } catch (e) {
    await flushLogs();
    const msg = String((e as Error)?.message || e);
    console.error("support-ai-agent", msg);
    return fallback(msg.slice(0, 300));
  }
}));
