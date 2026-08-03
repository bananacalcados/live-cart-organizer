// Fase 3 — Abatimento automático de prêmios da roleta (server-side).
//
// Resolve o melhor prêmio ativo da cliente (cupom % / valor fixo / frete grátis)
// e devolve o desconto a ser aplicado na cobrança. O prêmio é "reservado"
// (applied_order_id) na geração da cobrança e só é marcado como usado
// (is_redeemed) quando o pagamento é confirmado.

export type ResolvedPrize = {
  id: string;
  label: string;
  couponCode: string;
  prizeType: string;
  /** Desconto em R$ sobre o valor dos produtos. */
  discountAmount: number;
  /** Quando true, o frete deve ser zerado. */
  freeShipping: boolean;
};

const DISCOUNT_TYPES = ["discount_percent", "discount_fixed", "free_shipping"];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Busca o prêmio de maior valor aplicável ao pedido e o reserva.
 * Nunca lança: em qualquer falha retorna null (pagamento não pode travar).
 */
export async function resolveAndReservePrize(
  supabase: any,
  params: {
    orderId: string;
    phone?: string | null;
    /** Valor dos produtos já com descontos normais aplicados. */
    baseAmount: number;
    shippingAmount?: number;
  },
): Promise<ResolvedPrize | null> {
  try {
    const digits = String(params.phone || "").replace(/\D/g, "");
    if (digits.length < 8) return null;
    const last8 = digits.slice(-8);

    const { data, error } = await supabase
      .from("customer_prizes")
      .select("id, prize_label, prize_type, prize_value, coupon_code, expires_at, applied_order_id, is_redeemed, customer_phone")
      .eq("is_redeemed", false)
      .in("prize_type", DISCOUNT_TYPES)
      .gt("expires_at", new Date().toISOString())
      .ilike("customer_phone", `%${last8}`)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[prize-discount] erro ao buscar prêmios:", error.message);
      return null;
    }

    const base = Math.max(0, Number(params.baseAmount) || 0);
    const shipping = Math.max(0, Number(params.shippingAmount) || 0);

    const candidates: ResolvedPrize[] = (data || [])
      // Só usa prêmio livre ou já reservado para este mesmo pedido.
      .filter((p: any) => !p.applied_order_id || p.applied_order_id === params.orderId)
      .map((p: any) => {
        const value = Number(p.prize_value) || 0;
        let discountAmount = 0;
        let freeShipping = false;
        if (p.prize_type === "discount_percent") {
          discountAmount = round2(base * (value / 100));
        } else if (p.prize_type === "discount_fixed") {
          discountAmount = round2(Math.min(value, base));
        } else if (p.prize_type === "free_shipping") {
          freeShipping = shipping > 0;
        }
        return {
          id: p.id,
          label: p.prize_label,
          couponCode: p.coupon_code,
          prizeType: p.prize_type,
          discountAmount,
          freeShipping,
        };
      })
      .filter((p: ResolvedPrize) => p.discountAmount > 0 || p.freeShipping);

    if (!candidates.length) return null;

    // Melhor prêmio = maior abatimento total (desconto + frete economizado).
    candidates.sort(
      (a, b) =>
        (b.discountAmount + (b.freeShipping ? shipping : 0)) -
        (a.discountAmount + (a.freeShipping ? shipping : 0)),
    );
    const best = candidates[0];

    // Reserva o prêmio para este pedido (evita uso em dois pedidos ao mesmo tempo).
    await supabase
      .from("customer_prizes")
      .update({ applied_order_id: params.orderId })
      .eq("id", best.id)
      .eq("is_redeemed", false);

    console.log(
      `[prize-discount] Prêmio aplicado ao pedido ${params.orderId}: ${best.label} (${best.couponCode}) → -R$ ${best.discountAmount.toFixed(2)}${best.freeShipping ? " + frete grátis" : ""}`,
    );

    return best;
  } catch (e) {
    console.error("[prize-discount] falha inesperada:", e);
    return null;
  }
}

/** Marca como usados os prêmios reservados para o pedido pago. */
export async function redeemPrizesForOrder(supabase: any, orderId: string) {
  try {
    if (!orderId) return;
    const { data, error } = await supabase
      .from("customer_prizes")
      .update({ is_redeemed: true, redeemed_at: new Date().toISOString() })
      .eq("applied_order_id", orderId)
      .eq("is_redeemed", false)
      .select("id, coupon_code");
    if (error) {
      console.error("[prize-discount] erro ao baixar prêmios:", error.message);
      return;
    }
    if (data?.length) {
      console.log(`[prize-discount] ${data.length} prêmio(s) baixado(s) no pedido ${orderId}`);
    }
  } catch (e) {
    console.error("[prize-discount] falha ao baixar prêmios:", e);
  }
}
