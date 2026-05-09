/**
 * Helpers for per-product discounts on catalog lead pages (`/evento/:slug`).
 * Discount config is stored in `catalog_lead_pages.product_discounts` as:
 *   { [shopifyProductId]: { type: 'percent' | 'fixed_off' | 'fixed_price', value: number } }
 */

export type DiscountType = "percent" | "fixed_off" | "fixed_price";

export interface ProductDiscount {
  type: DiscountType;
  value: number;
}

export type DiscountMap = Record<string, ProductDiscount>;

/** Apply a single discount to a numeric price, returning the final price (>= 0). */
export function applyDiscount(price: number, d?: ProductDiscount | null): number {
  if (!d || !d.value || d.value <= 0) return price;
  let out = price;
  if (d.type === "percent") out = price * (1 - d.value / 100);
  else if (d.type === "fixed_off") out = price - d.value;
  else if (d.type === "fixed_price") out = d.value;
  return Math.max(0, Math.round(out * 100) / 100);
}

/** Compute the discount label badge ("-20%", "-R$ 30") if applicable. */
export function discountBadge(d?: ProductDiscount | null): string | null {
  if (!d || !d.value || d.value <= 0) return null;
  if (d.type === "percent") return `-${d.value}%`;
  if (d.type === "fixed_off") return `-R$ ${d.value.toFixed(0)}`;
  if (d.type === "fixed_price") return `OFERTA`;
  return null;
}
