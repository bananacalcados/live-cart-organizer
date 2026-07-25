import { supabase } from "@/integrations/supabase/client";
import { cpUpdateOrder } from "@/lib/checkoutPublic";

/**
 * Regra de frete do EVENTO (módulo Eventos → configuração do evento):
 *  - `fixed`     → valor fixo cobrado (ex.: R$ 19,99 na Live)
 *  - `freeAbove` → a partir deste subtotal o frete é grátis (ex.: R$ 459,99)
 *
 * Motivo do arquivo: quando o cadastro do cliente já existe (compra anterior ou
 * ficha preenchida pela vendedora), o checkout pula a etapa 2 (CEP/frete) e o
 * pedido seguia para o pagamento com frete ZERO — deixando de cobrar o frete.
 * Aqui centralizamos a resolução e a gravação do frete padrão do evento.
 */
export interface EventShippingRule {
  fixed: number | null;
  freeAbove: number | null;
}

export interface ResolvedShipping {
  shippingCost: number;
  freeShipping: boolean;
}

/** Lê a regra do evento via RPC pública (funciona para clientes anônimos). */
export async function fetchEventShippingRule(eventId?: string | null): Promise<EventShippingRule | null> {
  if (!eventId) return null;
  try {
    const { data } = await supabase.rpc("get_event_checkout_shipping" as any, { p_event_id: eventId });
    const row = data as any;
    if (!row) return null;
    const fixed = row.default_shipping_cost != null ? Number(row.default_shipping_cost) : null;
    const freeAbove = row.free_shipping_threshold != null ? Number(row.free_shipping_threshold) : null;
    if (!fixed && !freeAbove) return null;
    return { fixed: fixed && fixed > 0 ? fixed : null, freeAbove: freeAbove && freeAbove > 0 ? freeAbove : null };
  } catch {
    return null;
  }
}

/** Aplica a regra sobre o subtotal do pedido. Retorna null quando não há regra utilizável. */
export function resolveEventShipping(rule: EventShippingRule | null, subtotal: number): ResolvedShipping | null {
  if (!rule) return null;
  if (rule.freeAbove != null && subtotal >= rule.freeAbove) return { shippingCost: 0, freeShipping: true };
  if (rule.fixed != null) return { shippingCost: rule.fixed, freeShipping: false };
  return null;
}

/**
 * Garante o frete do evento no pedido quando nada foi selecionado ainda.
 * Não sobrescreve frete já definido nem pedidos marcados como frete grátis.
 */
export async function ensureEventShippingOnOrder(opts: {
  orderId: string;
  eventId?: string | null;
  subtotal: number;
  currentShippingCost?: number | null;
  currentFreeShipping?: boolean | null;
}): Promise<ResolvedShipping | null> {
  if (!opts.orderId || opts.orderId.startsWith("live-")) return null;
  if (opts.currentFreeShipping) return null;
  if (Number(opts.currentShippingCost || 0) > 0) return null;

  const rule = await fetchEventShippingRule(opts.eventId);
  const resolved = resolveEventShipping(rule, opts.subtotal);
  if (!resolved) return null;

  await cpUpdateOrder(opts.orderId, {
    shipping_cost: resolved.shippingCost,
    free_shipping: resolved.freeShipping,
    shipping_info: {
      source: "event_rule",
      carrier: resolved.freeShipping ? "Frete Grátis (regra do evento)" : "Frete fixo do evento",
      price: resolved.shippingCost,
      applied_at: new Date().toISOString(),
    },
  });

  return resolved;
}
