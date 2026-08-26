/**
 * Etapa 4 — leitura do bloqueio por chargeback devolvido pelas funções de cobrança.
 * As funções respondem 403 com { code: "CHARGEBACK_BLOCKED", chargeback: {...} }.
 */
export interface ChargebackBlockInfo {
  customer_name?: string | null;
  reason?: string | null;
  order_name?: string | null;
  amount?: number | null;
  chargeback_date?: string | null;
}

export async function parseChargebackBlock(
  error: unknown,
  data?: any,
): Promise<ChargebackBlockInfo | null> {
  if (data?.code === "CHARGEBACK_BLOCKED") return data.chargeback || {};

  const ctx = (error as any)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.clone().json();
      if (body?.code === "CHARGEBACK_BLOCKED") return body.chargeback || {};
    } catch {
      /* corpo não é JSON */
    }
  }
  return null;
}

export function chargebackBlockMessage(info: ChargebackBlockInfo): string {
  const who = info.customer_name ? ` ${info.customer_name}` : "";
  const order = info.order_name ? ` (pedido ${info.order_name})` : "";
  return `CLIENTE COM CHARGEBACK${who}${order}. Venda bloqueada — libere no painel de Chargebacks se for engano.`;
}
