export type PaymentConfirmedPayload = {
  pedido_id: string;
  loja?: string;
  gateway?: string | null;
  transaction_id?: string | null;
  source?: string | null;
};

export async function notifyPaymentConfirmed(payload: PaymentConfirmedPayload) {
  const webhookUrl = Deno.env.get("AGENTE2_PAGAMENTO_CONFIRMADO") || "https://api.bananacalcados.com.br/webhook/pagamento-confirmado";

  const body = {
    pedido_id: payload.pedido_id,
    loja: payload.loja || "centro",
    ...(payload.gateway ? { gateway: payload.gateway } : {}),
    ...(payload.transaction_id ? { transaction_id: payload.transaction_id } : {}),
    ...(payload.source ? { source: payload.source } : {}),
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`payment-confirmado ${response.status}: ${responseText}`);
  }

  console.log(`[payment-confirmado] delivered for order ${payload.pedido_id}: ${responseText || "ok"}`);

  return {
    ok: true,
    status: response.status,
    body: responseText,
  };
}
