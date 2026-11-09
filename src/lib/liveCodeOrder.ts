import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DbOrderProduct, DbOrder } from "@/types/database";
import { useCustomerStore } from "@/stores/customerStore";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { normalizeBRPhone } from "@/lib/phoneUtils";
import { isPresenterSizeAllowed } from "@/lib/livePresenterProducts";

const db = supabase as any;
const numId = (v?: string | null) => String(v || "").split("/").pop() || "";

export interface LiveConditions {
  items: Array<{ ref?: number; price: number; quantity: number; discounted?: boolean; promotion_id?: string | null; promotion_name?: string | null; tier_qty?: number; tier_total?: number }>;
  subtotal: number;
  free_shipping: boolean;
  free_shipping_reasons: string[];
  shipping_cost: number;
  cashback: { id: string; coupon_code: string; amount: number; min_purchase: number | null } | null;
  cashback_blocked: boolean;
  installment_config?: {
    max_installments: number;
    interest_free_installments: number;
    monthly_interest_rate: number;
    source: "live_presenter";
  } | null;
  open_order_id: string | null;
  paid_before: boolean;
}

/** shopify_product_id (só números) de um item do pedido, a partir do id `${produto}-${variação}`. */
export function productIdOf(p: Pick<DbOrderProduct, "id">): string {
  const first = String(p.id || "").split("-")[0];
  const m = first.match(/Product\/(\d+)$/) || first.match(/^(\d+)$/);
  return m ? m[1] : "";
}

/** Chama compute_live_order_conditions e devolve os produtos com preço/promoção do servidor. */
export async function computeLiveConditions(
  eventId: string, username: string, phone: string | null, products: DbOrderProduct[],
): Promise<{ cond: LiveConditions; products: DbOrderProduct[] }> {
  const items = products.map((p, i) => ({
    ref: i, shopify_product_id: productIdOf(p), quantity: p.quantity || 1,
    price: Number(p.basePrice ?? p.price),
  }));
  const { data, error } = await db.rpc("compute_live_order_conditions", {
    p_event_id: eventId, p_username: username.replace(/^@/, ""), p_phone: phone || null, p_items: items,
  });
  if (error) throw error;
  const cond = data as LiveConditions;
  const byRef = new Map<number, LiveConditions["items"][number]>();
  (cond.items || []).forEach((it) => { if (it.ref != null) byRef.set(Number(it.ref), it); });
  const adjusted = products.map((p, i) => {
    const it = byRef.get(i);
    if (!it) return p;
    const base = p.basePrice ?? p.price;
    return {
      ...p,
      basePrice: base,
      price: Number(it.price ?? p.price),
      promotion: it.promotion_name || undefined,
    };
  });
  return { cond, products: adjusted };
}

export function conditionsSummary(cond: LiveConditions) {
  const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return {
    subtotal: brl(cond.subtotal),
    shipping: cond.free_shipping
      ? `frete grátis${cond.free_shipping_reasons?.length ? ` (${cond.free_shipping_reasons.join(", ")})` : ""}`
      : `frete ${brl(cond.shipping_cost)}`,
    cashback: cond.cashback_blocked
      ? "cashback não se aplica (item em promoção)"
      : cond.cashback ? `cashback ${brl(cond.cashback.amount)}` : null,
    installments: cond.installment_config
      ? `até ${cond.installment_config.interest_free_installments}x sem juros`
      : null,
  };
}

/** Soma os itens novos no carrinho, juntando a mesma variação (nunca duplica a linha). */
export function mergeProducts(existing: DbOrderProduct[], added: DbOrderProduct[]): DbOrderProduct[] {
  const out = existing.map((p) => ({ ...p }));
  for (const a of added) {
    const hit = out.find((p) => p.id === a.id);
    if (hit) hit.quantity += a.quantity;
    else out.push({ ...a });
  }
  return out;
}

export interface CodeIntentLike {
  id: string; username: string; phone: string | null; phone_last4: string | null;
  kind?: string | null; target_order_id?: string | null;
}

const DIRECT_CONFIRM_WARNING = /não disponível na shopify|não está na shopify|não existe nessa cor/i;

/** Somente problemas do próprio item impedem a confirmação direta. */
export function codeIntentDirectConfirmBlocked(
  items: Array<{ size?: string | null; warnings?: string[] }>,
): boolean {
  return items.some((item) =>
    item.size == null || (item.warnings || []).some((warning) => DIRECT_CONFIRM_WARNING.test(warning)),
  );
}

/**
 * Confirma um card "Por código": adiciona ao carrinho aberto da pessoa nesta live
 * (kind='add' ou carrinho aberto encontrado) ou cria um pedido novo. Recalcula
 * preço, frete e cashback pelo compute com TODOS os itens do carrinho resultante.
 */
export async function confirmCodeIntentOrder(eventId: string, intent: CodeIntentLike, newProducts: DbOrderProduct[], by: string): Promise<string> {
  const username = intent.username.replace(/^@/, "");
  const phone = intent.phone || null;
  const pre = await computeLiveConditions(eventId, username, phone, newProducts);

  // R1: nunca um segundo carrinho para quem já tem carrinho não pago nesta live.
  let targetId: string | null = null;
  if (intent.target_order_id) {
    const { data: t } = await db.from("orders").select("id,is_paid,stage,merged_into_order_id").eq("id", intent.target_order_id).maybeSingle();
    if (t && !t.is_paid && !["cancelled", "paid", "shipped", "completed"].includes(t.stage) && !t.merged_into_order_id) targetId = t.id;
  }
  if (!targetId) targetId = pre.cond.open_order_id || null;

  let orderId: string;
  if (targetId) {
    const { data: ord, error } = await db.from("orders")
      .select("id,products,free_shipping,custom_shipping_cost,cashback_id,checkout_installment_config").eq("id", targetId).single();
    if (error) throw error;
    const merged = mergeProducts((ord.products || []) as DbOrderProduct[], newProducts);
    const { cond, products } = await computeLiveConditions(eventId, username, phone, merged);
    const free = !!ord.free_shipping || cond.free_shipping;
    const patch: Record<string, unknown> = { products, free_shipping: free };
    if (ord.custom_shipping_cost == null) patch.shipping_cost = free ? 0 : cond.shipping_cost;
    if (cond.cashback_blocked) patch.cashback_id = null;
    else if (cond.cashback && !ord.cashback_id) patch.cashback_id = cond.cashback.id;
    if (cond.installment_config && !ord.checkout_installment_config) patch.checkout_installment_config = cond.installment_config;
    const { error: upErr } = await db.from("orders").update(patch).eq("id", targetId);
    if (upErr) throw upErr;
    orderId = targetId;
  } else {
    // Mesmo serviço do modal Novo Pedido: cliente pelo @ (+ telefone) e createOrder.
    const wa = phone ? normalizeBRPhone(phone) : undefined;
    const customer = await useCustomerStore.getState().createOrUpdateCustomer(username, wa);
    if (!customer) throw new Error("Não foi possível criar o cliente");
    const created = await useDbOrderStore.getState().createOrder(eventId, customer, pre.products);
    if (!created) throw new Error("Não foi possível criar o pedido");
    const patch: Record<string, unknown> = {
      free_shipping: pre.cond.free_shipping,
      shipping_cost: pre.cond.free_shipping ? 0 : pre.cond.shipping_cost,
      cashback_id: !pre.cond.cashback_blocked && pre.cond.cashback ? pre.cond.cashback.id : null,
      ...(pre.cond.installment_config ? { checkout_installment_config: pre.cond.installment_config } : {}),
    };
    if (!phone && intent.phone_last4 && /^\d{4}$/.test(intent.phone_last4)) patch.phone_last4 = intent.phone_last4;
    await useDbOrderStore.getState().updateOrder(created.id, patch as Partial<DbOrder>);
    if (patch.phone_last4) await db.rpc("live_backfill_order_phone", { p_order_id: created.id });
    orderId = created.id;
  }

  const { error: rErr } = await db.rpc("resolve_live_order_intent", { p_intent_id: intent.id, p_action: "confirm", p_by: by, p_order_id: orderId });
  if (rErr) throw rErr;
  await useDbOrderStore.getState().fetchOrdersByEvent(eventId).catch(() => {});
  return orderId;
}

// ---- Tag NOVO ADD nos cards de atendimento: um canal por live, compartilhado ----
type Entry = { ids: Set<string>; listeners: Set<(s: Set<string>) => void>; ch: any; refs: number };
const addIntentStore = new Map<string, Entry>();

async function reloadAdd(eventId: string) {
  const e = addIntentStore.get(eventId);
  if (!e) return;
  const { data } = await db.from("live_order_intents").select("target_order_id")
    .eq("event_id", eventId).eq("kind", "add").in("status", ["incomplete", "ready"]).not("target_order_id", "is", null).limit(200);
  const next = new Set<string>((data || []).map((r: any) => r.target_order_id));
  const same = next.size === e.ids.size && [...next].every((x) => e.ids.has(x));
  if (same) return;
  e.ids = next;
  e.listeners.forEach((l) => l(next));
}

export function useOpenAddIntent(eventId: string | null | undefined, orderId: string): boolean {
  const [has, setHas] = useState(() => !!(eventId && addIntentStore.get(eventId)?.ids.has(orderId)));
  useEffect(() => {
    if (!eventId) return;
    let e = addIntentStore.get(eventId);
    if (!e) {
      e = { ids: new Set(), listeners: new Set(), ch: null, refs: 0 };
      addIntentStore.set(eventId, e);
      e.ch = supabase.channel(`live-add-intents-${eventId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "live_order_intents", filter: `event_id=eq.${eventId}` }, () => reloadAdd(eventId))
        .subscribe();
      reloadAdd(eventId);
    }
    e.refs++;
    const l = (s: Set<string>) => setHas(s.has(orderId));
    e.listeners.add(l);
    setHas(e.ids.has(orderId));
    return () => {
      const cur = addIntentStore.get(eventId);
      if (!cur) return;
      cur.listeners.delete(l);
      cur.refs--;
      if (cur.refs <= 0) { supabase.removeChannel(cur.ch); addIntentStore.delete(eventId); }
    };
  }, [eventId, orderId]);
  return has;
}
