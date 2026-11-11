// Contexto do agente de suporte (conversa, pedidos e dependências das ferramentas), usado pelo
// agente em modo sombra e pelo treino. Só leitura; o id real dos pedidos nunca vai para a IA.
import type { AgentDeps, ConvMessage, OrderCtx, TrackingInfo } from "./support-ai.ts";
import { firstName } from "./support-ai.ts";
import { cpfIdentityConfirmed, humanOtherInstances, unifyMessages, validCpf, type SupportFacts } from "./support-policy.ts";

export const ONLINE_CHANNELS = ["site", "live", "link_online", "whatsapp"];
export const TRACK_BASE = "https://checkout.bananacalcados.com.br/rastreio/";

export type SupportContext = {
  conv: ConvMessage[]; orders: OrderCtx[]; nome: string | null;
  saleIds: Map<string, string>;
  deps: Omit<AgentDeps, "offersAlreadyMade" | "maxOffers">;
  otherInstances: { id: string; label: string }[];
  configure: (facts: SupportFacts) => void;
};

// deno-lint-ignore no-explicit-any
type Sb = any;

export async function loadConversation(sb: Sb, phone: string, numberId: string | null, until?: string): Promise<ConvMessage[]> {
  const { data, error } = await sb.rpc("support_unified_messages", { p_phone: phone, p_until: until ?? new Date().toISOString(), p_limit: 200 });
  if (error) throw new Error("historico_unificado_indisponivel");
  return unifyMessages(data ?? []);
}

export async function buildSupportContext(sb: Sb, s: { phone: string; whatsapp_number_id: string | null; channel: string },
  opts: { shareLastEvent: boolean; until?: string; saleId?: string; sourceKey?: string }): Promise<SupportContext> {
  const conv = await loadConversation(sb, s.phone, s.whatsapp_number_id, opts.until);
  const s8 = String(s.phone || "").replace(/\D/g, "").slice(-8);
  const saleIds = new Map<string, string>(); const itemSku = new Map<string, string | null>();
  const sims = new Map<string, any>();
  let orders: OrderCtx[] = []; let nome: string | null = null;
  let facts: SupportFacts = {};
  const otherInstances = [...new Map(conv.filter(m => m.instance_id && m.instance_id !== s.whatsapp_number_id).map(m => [m.instance_id, { id: m.instance_id as string, label: m.instance ?? "WhatsApp" }])).values()];
  const humanIds = humanOtherInstances(conv, s.whatsapp_number_id, Date.parse(opts.until ?? new Date().toISOString()));
  const { data: conversationNames } = await sb.from("whatsapp_conversations").select("sender_name").eq("phone", s.phone).limit(1);
  const conversationName = firstName(conversationNames?.[0]?.sender_name);
  if (s.channel !== "instagram" && s8.length === 8) {
    let saleQuery = sb.from("pos_sales").select("id,created_at,sales_channel,status,customer_name,status_cancelamento");
    saleQuery = opts.saleId ? saleQuery.eq("id", opts.saleId) : saleQuery.eq("phone_suffix8", s8);
    const { data: sales } = await saleQuery.gte("created_at", new Date(Date.now() - 60 * 864e5).toISOString())
      .in("status", ["completed", "paid"]).order("created_at", { ascending: false }).limit(5);
    const valid = (sales ?? []).filter((x: any) => String(x.status_cancelamento ?? "") !== "cancelado");
    const ids = valid.map((x: any) => x.id);
    const [{ data: items }, { data: simRows }] = await Promise.all([
      ids.length ? sb.from("pos_sale_items").select("sale_id,product_name,size,variant_name,quantity,sku").in("sale_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? sb.from("shipment_simulations").select("id,sale_id,tracking_code,stage,stage_history,posted_at,delivered_at,incident_type,merged_into_id,real_events,created_at").in("sale_id", ids) : Promise.resolve({ data: [] }),
    ]);
    // Envio único: segue para o envio principal quando o pedido foi unificado.
    const parentIds = [...new Set((simRows ?? []).map((z: any) => z.merged_into_id).filter(Boolean))];
    const { data: parents } = parentIds.length
      ? await sb.from("shipment_simulations").select("id,sale_id,tracking_code,stage,stage_history,posted_at,delivered_at,incident_type,merged_into_id,real_events,created_at").in("id", parentIds)
      : { data: [] };
    for (const z of simRows ?? []) {
      const eff = z.merged_into_id ? (parents ?? []).find((p: any) => p.id === z.merged_into_id) ?? z : z;
      const prev = sims.get(z.sale_id);
      if (!prev || String(z.created_at) > String(prev.created_at)) sims.set(z.sale_id, eff);
    }
    nome = conversationName ?? firstName(valid[0]?.customer_name);
    orders = valid.map((x: any, i: number) => {
      const ref = `P${i + 1}`; saleIds.set(ref, x.id);
      const its = (items ?? []).filter((it: any) => it.sale_id === x.id).map((it: any, j: number) => {
        itemSku.set(`${ref}:I${j + 1}`, it.sku ?? null);
        return { item: `I${j + 1}`, produto: it.product_name, tamanho: it.size ?? it.variant_name ?? null, quantidade: it.quantity };
      });
      const sim = sims.get(x.id);
      return { ref, data: x.created_at.slice(0, 10), canal: ONLINE_CHANNELS.includes(x.sales_channel) ? "online" : "loja", status: x.status,
        entregue_em: sim?.delivered_at?.slice(0, 10) ?? null, itens: its } as OrderCtx;
    });
  }

  const deps: SupportContext["deps"] = {
    orders,
    checkEligibility: async (ref, tipo) => {
      const id = saleIds.get(ref);
      if (!id) return { elegivel: "needs_human", motivo: "pedido_inexistente", prazo_ate: null };
      const { data, error } = await sb.rpc("check_exchange_eligibility", { p_order_ref: id, p_request_type: tipo });
      if (error) return { elegivel: "needs_human", motivo: "erro_consulta", prazo_ate: null };
      return { elegivel: data?.eligible ?? "needs_human", motivo: data?.reason ?? "", prazo_ate: data?.deadline_at ? String(data.deadline_at).slice(0, 10) : null };
    },
    sizesInStock: async (ref, item) => {
      const sku = itemSku.get(`${ref}:${item}`);
      if (!sku) return { erro: "item_sem_codigo" };
      const { data: p } = await sb.from("pos_products").select("parent_sku").eq("sku", sku).not("parent_sku", "is", null).limit(1).maybeSingle();
      if (!p?.parent_sku) return { erro: "produto_sem_grade" };
      const { data: vs } = await sb.from("pos_products").select("size,stock").eq("parent_sku", p.parent_sku).gt("stock", 0).limit(200);
      return { tamanhos: [...new Set((vs ?? []).map((v: any) => String(v.size ?? "").trim()).filter(Boolean))].sort() as string[] };
    },
    tracking: async (ref) => trackingFromSim(sims.get(saleIds.get(ref) ?? ""), opts.shareLastEvent),
    cpfLookup: async () => {
      const cpfMessage = [...conv].reverse().find(m => m.from === "cliente" && /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(m.text));
      const raw = cpfMessage?.text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/)?.[0];
      if (!raw) return { found: false };
      // Raw digits never leave this server-side RPC or enter the AI transcript/actions/logs.
      const { data: candidate, error } = await sb.rpc("support_cpf_candidate", { p_phone: s.phone, p_cpf: raw, p_source_key: `${cpfMessage?.at}:${cpfMessage?.instance_id ?? ""}` });
      if (error) return { error: "consulta_cpf_indisponivel" };
      if (!validCpf(raw)) return { error: "cpf_invalido" };
      if (candidate?.error || !candidate?.found) return { error: candidate?.error ?? "cpf_sem_pedido_unico" };
      const confirmed = cpfIdentityConfirmed(conversationName, candidate.first_name, candidate.product, facts.confirmed_product ?? null);
      if (confirmed) {
        const { data: attempt } = await sb.from("support_cpf_attempts").select("candidate_sale_id").eq("id", candidate.id).maybeSingle();
        if (!attempt?.candidate_sale_id) return { error: "cpf_sem_pedido" };
        const loaded = await buildSupportContext(sb, s, { ...opts, saleId: attempt.candidate_sale_id });
        deps.orders.splice(0, deps.orders.length, ...loaded.orders);
        for (const [ref, id] of loaded.saleIds) saleIds.set(ref, id);
        deps.checkEligibility = loaded.deps.checkEligibility;
        deps.tracking = loaded.deps.tracking;
        deps.sizesInStock = loaded.deps.sizesInStock;
        await sb.from("support_cpf_attempts").update({ confirmed: true }).eq("id", candidate.id).eq("confirmed", false);
      }
      return { found: true, first_name: candidate.first_name, product: candidate.product, month: candidate.month, confirmed, different_phone: true };
    },
  };
  return { conv, orders, nome, saleIds, deps, otherInstances, configure: (value) => {
    facts = value;
    deps.consolidation = humanIds.includes(value.same_subject_instance ?? "") ? otherInstances.find(i => i.id === value.same_subject_instance) ?? null : null;
  } };
}

/** Mesmo link de rastreio enviado na confirmação de pagamento (/rastreio/<código BC>). */
export function trackingFromSim(sim: any, shareLastEvent: boolean, now = Date.now()): TrackingInfo | null {
  if (!sim) return { url: null, etapa: "sem_envio", enviado_em: null, entregue_em: null, ocorrencia: false, dias_desde_envio: null };
  const stage = ["em_separacao", "separado", "enviado", "entregue"].includes(sim.stage) ? sim.stage : "em_separacao";
  const sentAt: string | null = sim.stage_history?.enviado ?? (stage === "enviado" || stage === "entregue" ? sim.posted_at : null) ?? null;
  const evs = Array.isArray(sim.real_events) ? sim.real_events : [];
  const last = evs.length ? evs[evs.length - 1] : null;
  return {
    url: sim.tracking_code ? TRACK_BASE + sim.tracking_code : null,
    etapa: sim.delivered_at ? "entregue" : stage,
    enviado_em: sentAt ? String(sentAt).slice(0, 10) : null,
    entregue_em: sim.delivered_at ? String(sim.delivered_at).slice(0, 10) : null,
    ocorrencia: !!sim.incident_type,
    dias_desde_envio: sentAt ? Math.floor((now - new Date(sentAt).getTime()) / 864e5) : null,
    // Preparado e desligado (support_settings.tracking_share_last_event): último evento do rastreio, sem transportadora nem código real.
    ...(shareLastEvent && last ? { ultimo_evento: String(last.description ?? last.status ?? last.descricao ?? "").slice(0, 200) || null } : {}),
  };
}
