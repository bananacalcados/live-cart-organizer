export function normalizeGatewayPaymentLabel(params: {
  gateway?: string | null;
  paymentTypeId?: string | null;
  paymentMethodId?: string | null;
  installments?: number | null;
  rawLabel?: string | null;
}) {
  const gateway = String(params.gateway || "").toLowerCase();
  const typeId = String(params.paymentTypeId || "").toLowerCase();
  const methodId = String(params.paymentMethodId || "").toLowerCase();
  const raw = String(params.rawLabel || "").trim();
  const installments = Number(params.installments || 1);

  if (raw) return raw;

  if (methodId === "pix" || typeId === "pix" || typeId === "account_money" || typeId === "bank_transfer") {
    return "PIX";
  }

  if (typeId === "credit_card" || methodId === "credit_card") {
    return installments > 1 ? `Cartão de Crédito ${installments}x` : "Cartão de Crédito";
  }

  if (typeId === "debit_card" || methodId === "debit_card") {
    return "Cartão de Débito";
  }

  if (typeId === "boleto" || methodId === "boleto" || methodId.includes("bol")) {
    return "Boleto";
  }

  if (gateway === "mercadopago") return "PIX";
  if (gateway === "pagarme" || gateway === "vindi" || gateway === "appmax") {
    return installments > 1 ? `Cartão de Crédito ${installments}x` : "Cartão de Crédito";
  }

  return null;
}

export async function syncOrderPaymentToPosSale(
  supabase: any,
  params: {
    orderId: string;
    paymentMethodLabel?: string | null;
    installments?: number | null;
    paymentGateway?: string | null;
    transactionField?: string | null;
    transactionValue?: string | null;
    paidAt?: string | null;
  },
) {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, pos_sale_id")
    .eq("id", params.orderId)
    .maybeSingle();

  if (orderErr || !order?.pos_sale_id) {
    if (orderErr) console.error("[payment-method-sync] order lookup failed:", orderErr);
    return;
  }

  const { data: sale, error: saleErr } = await supabase
    .from("pos_sales")
    .select("id, payment_method, payment_details, status")
    .eq("id", order.pos_sale_id)
    .maybeSingle();

  if (saleErr || !sale) {
    if (saleErr) console.error("[payment-method-sync] pos_sale lookup failed:", saleErr);
    return;
  }

  const paymentDetails = { ...((sale.payment_details as Record<string, unknown> | null) || {}) };
  const updates: Record<string, unknown> = {
    payment_details: {
      ...paymentDetails,
      payment_method: params.paymentMethodLabel || paymentDetails.payment_method || null,
      installments: params.installments ?? paymentDetails.installments ?? null,
    },
  };

  if (!sale.payment_method && params.paymentMethodLabel) {
    updates.payment_method = params.paymentMethodLabel;
  }

  if (params.paymentGateway) {
    updates.payment_gateway = params.paymentGateway;
  }

  if (sale.status !== "paid" && sale.status !== "completed") {
    updates.status = "paid";
  }

  if (params.paidAt) {
    updates.paid_at = params.paidAt;
  }

  if (params.transactionField && params.transactionValue) {
    updates[params.transactionField] = params.transactionValue;
  }

  const { error: updateErr } = await supabase
    .from("pos_sales")
    .update(updates as any)
    .eq("id", order.pos_sale_id);

  if (updateErr) {
    console.error("[payment-method-sync] pos_sale update failed:", updateErr);
  }
}