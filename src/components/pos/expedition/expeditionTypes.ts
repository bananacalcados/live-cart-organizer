import { supabase } from "@/integrations/supabase/client";

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
  tracking_code: string | null;
  tracking_carrier: string | null;
  courier_name: string | null;
  pickup_store_id: string | null;
  instagram?: string | null;
  delivery_method?: string | null;
  items: ExpItem[];
  origin: ExpOrigin;
  is_avulso: boolean;
  avulso_ready: boolean;
}

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
  "Jadlog",
  "Loggi",
  "Transportadora",
  "Mototaxi",
  "Retirada na loja",
];

export const isCarrierWithTracking = (c: string) =>
  !!c && c !== "Mototaxi" && c !== "Retirada na loja";

export const trackingLink = (code: string) =>
  `https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(code)}`;

export const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function fetchExpeditionOrders(
  storeId: string,
  stage: ExpStage,
): Promise<ExpOrder[]> {
  const { data: sales, error } = await supabase
    .from("pos_sales")
    .select(
      "id, store_id, created_at, total, discount, subtotal, status, sale_type, payment_method, payment_method_detail, payment_gateway, payment_details, notes, customer_id, customer_name, customer_phone, customer_email, customer_cpf, shipping_address, shipping_notes, seller_id, event_id, source_order_id, expedition_stage, expedition_group_id, expedition_finished_at, shipping_carrier, tracking_code, tracking_carrier, courier_name, pickup_store_id",
    )
    .eq("store_id", storeId)
    .eq("expedition_stage", stage)
    .in("sale_type", ["live", "online"])
    .neq("status", "cancelled")
    .order("created_at", { ascending: stage !== "concluido" })
    .limit(400);

  if (error) throw error;
  const rows = (sales || []) as any[];
  if (!rows.length) return [];

  const ids = rows.map((s) => s.id);
  const sellerIds = [...new Set(rows.map((s) => s.seller_id).filter(Boolean))];
  const eventIds = [...new Set(rows.map((s) => s.event_id).filter(Boolean))];
  const orderIds = [...new Set(rows.map((s) => s.source_order_id).filter(Boolean))];

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

  return rows.map((s) => {
    const src = s.source_order_id ? orderMap.get(s.source_order_id) : null;
    return {
      ...s,
      items: itemsBySale.get(s.id) || [],
      origin: getOrigin(s),
      is_avulso: isAvulsoSale(s),
      avulso_ready: isAvulsoReady(s),
      seller_name: s.seller_id ? sellerMap.get(s.seller_id) || null : null,
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
