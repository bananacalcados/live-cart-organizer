// Cópia de live-catalog/cashback.ts (mesma regra; manter as duas iguais).
// Regra de cashback do catálogo cross-sell (pura, testada em src/test/liveCatalogCashback.test.ts).
// Itens promocionais nunca contam; o cupom só vale se o elegível atingir a compra mínima,
// e o abatimento nunca passa do valor elegível.
export interface CatalogItem { price: number; quantity: number; promo?: boolean }
export interface Coupon { id: string; cashback_amount: number; min_purchase: number; expires_at?: string }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function eligibleSubtotal(items: CatalogItem[]): number {
  return r2(items.filter((i) => !i.promo).reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0));
}

export function computeCatalogCashback(items: CatalogItem[], coupon: Coupon | null) {
  const eligible = eligibleSubtotal(items);
  if (!coupon || Number(coupon.cashback_amount) <= 0) return { cashback_id: null as string | null, amount: 0, eligible, min_purchase_hint: null as number | null };
  const min = Number(coupon.min_purchase || 0);
  if (eligible <= 0 || eligible < min) return { cashback_id: null, amount: 0, eligible, min_purchase_hint: min > 0 ? min : null };
  return { cashback_id: coupon.id, amount: r2(Math.min(Number(coupon.cashback_amount), eligible)), eligible, min_purchase_hint: null };
}

/** Preço exibido no catálogo: o cashback ainda não usado no carrinho abate do preço normal. */
export function yourPrice(price: number, promo: boolean, coupon: Coupon | null, appliedInCart: number) {
  if (promo || !coupon) return { your_price: r2(price), cashback_discount: 0 };
  const remaining = Math.max(0, Number(coupon.cashback_amount) - appliedInCart);
  const disc = r2(Math.min(remaining, price));
  return { your_price: r2(Math.max(0, price - disc)), cashback_discount: disc };
}
