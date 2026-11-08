// Shared by reverse and exchange modes; prices come only from the source sale.
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface ReturnSalePrice {
  unit_price: number;
  quantity: number;
}

export function returnDiscountRatio(items: ReturnSalePrice[], discount: number) {
  const gross = items.reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
  const roundedDiscount = round2(Number(discount || 0));
  return roundedDiscount > 0 && gross > 0 ? roundedDiscount / gross : 0;
}

export function returnLineValues(price: number, quantity: number, discountRatio: number) {
  const unitPrice = round2(Number(price));
  const gross = round2(unitPrice * Number(quantity));
  const discount = discountRatio > 0 ? round2(gross * discountRatio) : 0;
  return { unitPrice, gross, discount, net: round2(gross - discount) };
}

// Only diagnose an omitted discount when the authorized reverse's amount actually
// matches the gross amount. Never label another mismatch as a missing discount.
export function isUndiscountedReverse(input: {
  reason: string; reverseLinked: boolean; authorized: boolean;
  issued: number; gross: number; net: number;
}) {
  return input.reason === 'divergente' && input.reverseLinked && input.authorized
    && input.gross - input.net > 0.01
    && Math.abs(input.issued - input.gross) <= 0.01;
}