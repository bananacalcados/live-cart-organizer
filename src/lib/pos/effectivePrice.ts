// Rateio de desconto do pedido nos itens para descobrir o preço unitário
// efetivamente pago pelo cliente (usado em trocas/devoluções).
//
// pos_sale_items.unit_price guarda o preço de tabela. O desconto vive em
// pos_sales.discount (nível do pedido). Se ignorarmos, a troca considera o
// valor cheio e distorce diferenças/vouchers.

export interface EffectivePriceItem {
  unit_price: number;
  quantity: number;
}

export interface EffectivePriceResult {
  factor: number;        // multiplicador aplicado (1 = sem desconto)
  effective: number[];   // preço unitário efetivo por item, na mesma ordem
}

/**
 * Rateia proporcionalmente o desconto do pedido entre os itens.
 * Ajusta a última linha para casar exatamente com (subtotal - discount).
 */
export function computeEffectiveUnitPrices(
  items: EffectivePriceItem[],
  discount: number,
  saleTotalFallback?: number | null,
): EffectivePriceResult {
  const safeItems = items.map((i) => ({
    unit_price: Number(i.unit_price) || 0,
    quantity: Number(i.quantity) || 0,
  }));
  const subtotal = safeItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const disc = Math.max(0, Number(discount) || 0);

  if (subtotal <= 0 || disc <= 0) {
    return { factor: 1, effective: safeItems.map((i) => round2(i.unit_price)) };
  }

  const target = saleTotalFallback != null && saleTotalFallback > 0
    ? Number(saleTotalFallback)
    : Math.max(0, subtotal - disc);

  const factor = target / subtotal;
  const effective = safeItems.map((i) => round2(i.unit_price * factor));

  // Ajuste de arredondamento na última linha com quantidade > 0
  const currentTotal = safeItems.reduce(
    (s, i, idx) => s + effective[idx] * i.quantity,
    0,
  );
  const diff = round2(target - currentTotal);
  if (diff !== 0) {
    for (let k = safeItems.length - 1; k >= 0; k--) {
      if (safeItems[k].quantity > 0) {
        effective[k] = round2(effective[k] + diff / safeItems[k].quantity);
        break;
      }
    }
  }

  return { factor, effective };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
