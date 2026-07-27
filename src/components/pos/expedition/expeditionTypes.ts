import { supabase } from "@/integrations/supabase/client";
import { isOnlineOnlyStore } from "@/lib/pos/onlineStore";


export type ExpStage = "novo" | "preparacao" | "separacao" | "conferencia" | "concluido";

export const EXP_STAGES: { id: ExpStage; label: string; color: string; bg: string }[] = [
  { id: "novo", label: "Novos Pedidos", color: "text-exp-new", bg: "bg-exp-new" },
  { id: "preparacao", label: "Preparação", color: "text-exp-prep", bg: "bg-exp-prep" },
  { id: "separacao", label: "Separação", color: "text-exp-pick", bg: "bg-exp-pick" },
  { id: "conferencia", label: "Conferência", color: "text-exp-check", bg: "bg-exp-check" },
  { id: "concluido", label: "Concluídos", color: "text-exp-done", bg: "bg-exp-done" },
];

export const nextStage = (s: ExpStage): ExpStage | null => {
  const idx = EXP_STAGES.findIndex((e) => e.id === s);
  return idx >= 0 && idx < EXP_STAGES.length - 1 ? EXP_STAGES[idx + 1].id : null;
};

export const prevStage = (s: ExpStage): ExpStage | null => {
  const idx = EXP_STAGES.findIndex((e) => e.id === s);
  return idx > 0 ? EXP_STAGES[idx - 1].id : null;
};


export type ExpOrigin = "live" | "whatsapp" | "online";

export const ORIGIN_LABEL: Record<ExpOrigin, string> = {
  live: "Live",
  whatsapp: "WhatsApp",
  online: "Online",
};

export interface ExpItem {
  id: string;
  sale_id: string;
  sku: string | null;
  barcode: string | null;
  product_name: string | null;
  variant_name: string | null;
  size: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface ExpOrder {
  id: string;
  store_id: string;
  created_at: string;
  total: number;
  discount: number;
  subtotal: number;
  status: string;
  sale_type: string | null;
  payment_method: string | null;
  payment_method_detail: string | null;
  payment_gateway: string | null;
  payment_details: any;
  notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_cpf: string | null;
  shipping_address: any;
  shipping_notes: string | null;
  seller_id: string | null;
  seller_name?: string | null;
  event_id: string | null;
  event_name?: string | null;
  source_order_id: string | null;
  expedition_stage: ExpStage;
  expedition_group_id: string | null;
  expedition_finished_at: string | null;
  shipping_carrier: string | null;
  shipping_cost: number | null;
  tracking_code: string | null;
  tracking_carrier: string | null;
  courier_name: string | null;
  pickup_store_id: string | null;
  has_gift?: boolean | null;
  gift_description?: string | null;
  gift_added_at?: string | null;
  gift_after_completion?: boolean | null;
  instagram?: string | null;
  delivery_method?: string | null;
  items: ExpItem[];
  /**
   * Preenchido apenas quando o card representa um ENVIO UNIFICADO
   * (vários pedidos do mesmo cliente agrupados por expedition_group_id).
   * Contém os ids de TODAS as vendas do grupo, incluindo a principal.
   */
  group_order_ids?: string[];
  origin: ExpOrigin;
  is_avulso: boolean;
  avulso_ready: boolean;
  is_test?: boolean;
  /** Telefone do cliente já resolvido (venda ou metadados do link/PIX). */
  resolved_phone?: string | null;
  /** Vendedor(a) que gerou o link/PIX — venda, metadados do link ou atendimento no chat. */
  seller_label?: string | null;
  seller_source?: "sale" | "link" | "chat" | null;
  /** Instância de WhatsApp em que a conversa/link aconteceu. */
  wa_number_id?: string | null;
  wa_instance_label?: string | null;
}

/**
 * A Expedição só existe para pedidos PAGOS.
 * Links de pagamento/PIX gerados e ainda não quitados ficam em `online_pending`
 * (ou `pending` / `pending_pickup` / `payment_failed`) e NÃO podem aparecer aqui.
 */
export const UNPAID_STATUSES = ["online_pending", "pending", "pending_pickup", "payment_failed", "cancelled"];
export const PAID_FILTER = "paid_at.not.is.null,status.in.(completed,paid,pending_sync)";

export const onlyDigits = (v?: string | null) => (v || "").replace(/\D/g, "");

export const salePhone = (sale: any): string | null => {
  const pd = sale?.payment_details || {};
  const raw = sale?.customer_phone || pd.customer_phone || pd.customer_whatsapp || "";
  const d = onlyDigits(raw);
  return d.length >= 8 ? d : null;
};


export const getOrigin = (sale: any): ExpOrigin => {
  if (sale.sale_type === "live") return "live";
  const lo = sale.payment_details?.link_origin;
  if (lo === "whatsapp_chat" || lo === "chat") return "whatsapp";
  return "online";
};

/** Cobranças sem produto (link avulso / PIX avulso do WhatsApp) */
export const isAvulsoSale = (sale: any): boolean => {
  const pd = sale?.payment_details || {};
  if (pd.is_avulso === true) return true;
  if (pd.is_custom_amount === true) return true;
  if (pd.link_origin === "custom_link") return true;
  if ((sale?.notes || "").toLowerCase().includes("avulso")) return true;
  return false;
};

/** Avulso só pode avançar após o vendedor completar produto + dados + envio */
export const isAvulsoReady = (sale: any): boolean =>
  sale?.payment_details?.avulso_completed === true;

export const SHIPPING_OPTIONS = [
  "Correios PAC",
  "Correios SEDEX",
  "J&T Express",
  "Jadlog",
  "Loggi",
  "Transportadora",
  "Mototaxi",
  "Retirada na loja",
];

/**
 * Formas de envio = lista padrão + transportadoras cadastradas em
 * Configurações > Prestadores de serviço (nunca quebra se a consulta falhar).
 */
export async function fetchShippingOptions(): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("service_providers" as any)
      .select("name, provider_type, is_active")
      .eq("is_active", true);
    const extra = ((data || []) as any[])
      .filter((p) => p.provider_type === "transportadora")
      .map((p) => String(p.name).trim())
      .filter(Boolean);
    const all = [...SHIPPING_OPTIONS];
    for (const n of extra) if (!all.some((o) => o.toLowerCase() === n.toLowerCase())) all.splice(all.length - 2, 0, n);
    return all;
  } catch {
    return [...SHIPPING_OPTIONS];
  }
}

export const isPickup = (c?: string | null) => (c || "").toLowerCase().includes("retirada");

export const isMototaxi = (c?: string | null) => (c || "").toLowerCase().includes("moto");

export const isCarrierWithTracking = (c: string) => !!c && !isMototaxi(c) && !isPickup(c);


export const trackingLink = (code: string) =>
  `https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(code)}`;

export const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function fetchExpeditionOrders(
  storeId: string,
  stage: ExpStage,
): Promise<ExpOrder[]> {
  const SALE_COLS =
    "id, store_id, created_at, total, discount, subtotal, status, sale_type, payment_method, payment_method_detail, payment_gateway, payment_details, notes, customer_id, customer_name, customer_phone, customer_email, customer_cpf, shipping_address, shipping_notes, shipping_cost, seller_id, event_id, source_order_id, expedition_stage, expedition_group_id, expedition_finished_at, shipping_carrier, tracking_code, tracking_carrier, courier_name, pickup_store_id, has_gift, gift_description, gift_added_at, gift_after_completion, payment_on_delivery, expected_payment_method, delivery_payment_received_at, delivery_payment_method";

  const baseQuery = () =>
    supabase
      .from("pos_sales")
      .select(SALE_COLS)
      .eq("store_id", storeId)
      .eq("expedition_stage", stage)
      .in("sale_type", ["live", "online"])
      .order("created_at", { ascending: stage !== "concluido" })
      .limit(400);

  let { data: sales, error } = await baseQuery()
    .not("status", "in", `(${UNPAID_STATUSES.join(",")})`)
    .or(PAID_FILTER);

  // Fallback defensivo: se o filtro composto falhar no PostgREST, ainda exibimos
  // a aba (apenas com o filtro simples de status não-pagos).
  if (error) {
    const retry = await baseQuery().not("status", "in", `(${UNPAID_STATUSES.join(",")})`);
    if (retry.error) throw retry.error;
    sales = retry.data as any;
  }

  // Pedidos liberados como PAGAMENTO NA ENTREGA entram na Expedição mesmo
  // sem pagamento confirmado (mototaxista recebe no ato da entrega).
  let rows = (sales || []) as any[];
  try {
    const { data: podSales } = await baseQuery().eq("payment_on_delivery", true);
    for (const s of (podSales || []) as any[]) {
      if (s.status === "cancelled") continue;
      if (!rows.some((r) => r.id === s.id)) rows.push(s);
    }
  } catch {
    /* best-effort */
  }

  if (!rows.length) return [];


  // Loja 100% online (Site/Live) não tem vendedora humana: nenhuma venda dela
  // pode ser atribuída a vendedora/atendente.
  let storeIsOnlineOnly = false;
  try {
    const { data: storeRow } = await supabase
      .from("pos_stores")
      .select("name")
      .eq("id", storeId)
      .maybeSingle();
    storeIsOnlineOnly = isOnlineOnlyStore((storeRow as any)?.name);
  } catch {
    /* best-effort */
  }

  const ids = rows.map((s) => s.id);
  const sellerIds = [...new Set(rows.map((s) => s.seller_id).filter(Boolean))];
  const eventIds = [...new Set(rows.map((s) => s.event_id).filter(Boolean))];
  const orderIds = [...new Set(rows.map((s) => s.source_order_id).filter(Boolean))];
  const phones = [...new Set(rows.map((s) => salePhone(s)).filter(Boolean))] as string[];


  const [itemsRes, sellersRes, eventsRes, ordersRes] = await Promise.all([
    supabase.from("pos_sale_items").select("*").in("sale_id", ids),
    sellerIds.length
      ? supabase.from("pos_sellers").select("id, name").in("id", sellerIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    eventIds.length
      ? supabase.from("events").select("id, name").in("id", eventIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    orderIds.length
      ? supabase
          .from("orders")
          .select("id, delivery_method, is_pickup, pickup_store_id")
          .in("id", orderIds as string[])
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const itemsBySale = new Map<string, ExpItem[]>();
  for (const it of (itemsRes.data || []) as any[]) {
    const arr = itemsBySale.get(it.sale_id) || [];
    arr.push(it as ExpItem);
    itemsBySale.set(it.sale_id, arr);
  }
  const sellerMap = new Map((sellersRes.data || []).map((s: any) => [s.id, s.name]));
  const eventMap = new Map((eventsRes.data || []).map((e: any) => [e.id, e.name]));
  const orderMap = new Map((ordersRes.data || []).map((o: any) => [o.id, o]));

  // Enriquecimento opcional (atendente do chat + instância). NUNCA pode derrubar a lista:
  // é consultado por telefone exato e qualquer falha é ignorada.
  const instMap = new Map<string, string>();
  const attendantBySuffix = new Map<string, string>();
  const instBySuffix = new Map<string, string>();
  if (phones.length) {
    try {
      const [assignRes, instRes] = await Promise.all([
        supabase
          .from("chat_conversation_assignments")
          .select("phone, assigned_name, whatsapp_number_id, updated_at")
          .in("phone", phones.slice(0, 200))
          .order("updated_at", { ascending: false })
          .limit(300),
        supabase.from("whatsapp_numbers_safe").select("id, label, phone_display"),
      ]);
      for (const i of ((instRes as any).data || []) as any[]) {
        instMap.set(i.id, i.label || i.phone_display || "Instância");
      }
      for (const a of ((assignRes as any).data || []) as any[]) {
        const suf = onlyDigits(a.phone).slice(-8);
        if (!suf) continue;
        if (a.assigned_name && !attendantBySuffix.has(suf)) attendantBySuffix.set(suf, a.assigned_name);
        if (a.whatsapp_number_id && !instBySuffix.has(suf)) instBySuffix.set(suf, a.whatsapp_number_id);
      }
    } catch {
      /* enriquecimento é best-effort */
    }
  }


  return rows.map((s) => {
    const src = s.source_order_id ? orderMap.get(s.source_order_id) : null;
    const phone = salePhone(s);
    const suf = phone ? phone.slice(-8) : "";
    const saleSeller = storeIsOnlineOnly ? null : s.seller_id ? sellerMap.get(s.seller_id) || null : null;
    const linkSeller = storeIsOnlineOnly ? null : s.payment_details?.seller_name || null;
    const chatSeller = storeIsOnlineOnly ? null : suf ? attendantBySuffix.get(suf) || null : null;
    const seller_label = saleSeller || linkSeller || chatSeller || null;
    const waId = suf ? instBySuffix.get(suf) || null : null;
    return {
      ...s,
      items: itemsBySale.get(s.id) || [],
      origin: getOrigin(s),
      is_avulso: isAvulsoSale(s),
      is_test: s.payment_details?.is_test === true,
      avulso_ready: isAvulsoReady(s),
      seller_name: saleSeller,
      seller_label,
      seller_source: saleSeller ? "sale" : linkSeller ? "link" : chatSeller ? "chat" : null,

      resolved_phone: phone,
      wa_number_id: waId,
      wa_instance_label: waId ? instMap.get(waId) || null : null,
      event_name: s.event_id ? eventMap.get(s.event_id) || null : null,
      instagram: s.payment_details?.instagram || null,
      delivery_method:
        s.shipping_carrier ||
        (src?.is_pickup ? "Retirada na loja" : src?.delivery_method) ||
        s.tracking_carrier ||
        null,
    } as ExpOrder;
  });
}


export const customerKey = (o: ExpOrder) =>
  (o.customer_id ||
    (o.customer_phone || "").replace(/\D/g, "").slice(-8) ||
    (o.customer_name || "").toLowerCase().trim() ||
    o.id) as string;

/**
 * Junta os pedidos de um ENVIO UNIFICADO em um único "pedido" de conferência.
 * A venda mais antiga vira a principal (dados do cliente/envio/NF-e) e os itens
 * de todas as vendas do grupo são somados. Não altera nada no banco.
 */
export function mergeExpeditionGroup(list: ExpOrder[]): ExpOrder {
  if (list.length <= 1) return list[0];
  const sorted = [...list].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const master = sorted[0];
  return {
    ...master,
    items: sorted.flatMap((o) => o.items),
    total: sorted.reduce((s, o) => s + (Number(o.total) || 0), 0),
    subtotal: sorted.reduce((s, o) => s + (Number(o.subtotal) || 0), 0),
    discount: sorted.reduce((s, o) => s + (Number(o.discount) || 0), 0),
    has_gift: sorted.some((o) => !!o.has_gift),
    gift_description:
      sorted.map((o) => o.gift_description).filter(Boolean).join(" | ") || master.gift_description,
    gift_after_completion: sorted.some((o) => !!o.gift_after_completion),
    group_order_ids: sorted.map((o) => o.id),
  };
}
