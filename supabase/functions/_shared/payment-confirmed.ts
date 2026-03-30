export type PaymentConfirmedPayload = {
  pedido_id: string;
  loja?: string;
  gateway?: string | null;
  transaction_id?: string | null;
  source?: string | null;
};

async function triggerLiveteConfirmation(orderId: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) return;

    // Fire-and-forget: the livete function checks if it's an event order internally
    fetch(`${supabaseUrl}/functions/v1/livete-payment-confirmation`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    }).catch(err => console.error("[payment-confirmed] livete confirmation error:", err));
  } catch (err) {
    console.error("[payment-confirmed] livete trigger error:", err);
  }
}

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

  // Trigger Livete payment confirmation (fire-and-forget)
  triggerLiveteConfirmation(payload.pedido_id);

  return {
    ok: true,
    status: response.status,
    body: responseText,
  };
}
