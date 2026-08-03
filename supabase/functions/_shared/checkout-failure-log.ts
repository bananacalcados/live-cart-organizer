// Registro central de FALHAS de checkout (ponto cego de observabilidade).
//
// Antes, só recusas de cartão e webhooks entravam em `pos_checkout_attempts`.
// Erros na geração do PIX e travas da Área de Membros não deixavam rastro —
// quando a cliente dizia "não consegui pagar" não havia nada para investigar.
//
// Regras:
//  - NUNCA lança: falha de log jamais pode derrubar o fluxo de pagamento.
//  - `sale_id` é TEXT: quando não existe pedido, use um sentinela legível
//    (ex.: `member-area:5533999990000`) para não perder o registro.
export type CheckoutFailureLog = {
  sale_id: string;
  payment_method: string;
  gateway?: string | null;
  status?: "failed" | "error" | "processing";
  error_message?: string | null;
  amount?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  transaction_id?: string | null;
  store_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function logCheckoutFailure(
  supabase: { from: (t: string) => any },
  entry: CheckoutFailureLog,
): Promise<void> {
  try {
    const { error } = await supabase.from("pos_checkout_attempts").insert({
      sale_id: String(entry.sale_id || "unknown").slice(0, 200),
      payment_method: entry.payment_method,
      gateway: entry.gateway ?? null,
      status: entry.status || "error",
      error_message: entry.error_message ? String(entry.error_message).slice(0, 1000) : null,
      amount: entry.amount ?? null,
      customer_name: entry.customer_name ?? null,
      customer_phone: entry.customer_phone ?? null,
      customer_email: entry.customer_email ?? null,
      transaction_id: entry.transaction_id ?? null,
      store_id: entry.store_id ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) console.error("[checkout-failure-log] insert falhou:", error.message);
  } catch (e) {
    console.error("[checkout-failure-log] exceção ignorada:", e);
  }
}
