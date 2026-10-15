// Divisão de vendas no cartão entre gateways (configurada em Administração > Pagamentos).
// O gateway inicial é escolhido de forma DETERMINÍSTICA pelo id do pedido: a mesma
// cliente tentando de novo sempre começa no mesmo gateway (evita cobrança em dois lugares).
// Os demais seguem a ordem fixa da cascata como plano B.

export const DEFAULT_CARD_ORDER = ["mercadopago", "pagarme", "vindi", "appmax"] as const;
export type CardGateway = typeof DEFAULT_CARD_ORDER[number];
const SPLITTABLE = ["mercadopago", "pagarme", "appmax"] as const;

/** Hash estável 0..99 do id do pedido (FNV-1a). */
export function bucketFor(orderId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < orderId.length; i++) {
    h ^= orderId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export function pickStartGateway(orderId: string, pct: Record<string, number>): CardGateway | null {
  const total = SPLITTABLE.reduce((s, g) => s + Math.max(0, Number(pct[g]) || 0), 0);
  if (total !== 100) return null;
  const b = bucketFor(orderId);
  let acc = 0;
  for (const g of SPLITTABLE) {
    acc += Math.max(0, Number(pct[g]) || 0);
    if (b < acc) return g;
  }
  return null;
}

export function buildCardOrder(start: CardGateway | null): CardGateway[] {
  if (!start) return [...DEFAULT_CARD_ORDER];
  return [start, ...DEFAULT_CARD_ORDER.filter((g) => g !== start)];
}

/** Lê a configuração; qualquer erro devolve a ordem padrão (comportamento de hoje). */
export async function resolveCardOrder(supabase: any, orderId: string): Promise<{ order: CardGateway[]; start: CardGateway | null; splitOn: boolean }> {
  try {
    const { data, error } = await supabase
      .from("gateway_split_config")
      .select("enabled, percentages")
      .eq("id", true)
      .maybeSingle();
    if (error || !data?.enabled) return { order: [...DEFAULT_CARD_ORDER], start: null, splitOn: false };
    const start = pickStartGateway(String(orderId), (data.percentages || {}) as Record<string, number>);
    return { order: buildCardOrder(start), start, splitOn: true };
  } catch {
    return { order: [...DEFAULT_CARD_ORDER], start: null, splitOn: false };
  }
}
