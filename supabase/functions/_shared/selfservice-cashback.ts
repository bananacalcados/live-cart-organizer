import { getMpAccountForOrder } from "./mp-account.ts";
import { mpGetPayment } from "./mp-http.ts";
import { appmaxGetPayment, APPMAX_PAID } from "./refund-gateways/appmax.ts";
import { resolveAustpayConfig, austpayGetTransaction } from "./austpay.ts";

/** Only exact linked transactions; missing provider evidence blocks credit, never guesses time/amount. */
export async function grantSelfserviceCashback(sb: any, orderId: string) {
  const { data: o, error } = await sb.from("orders").select("id,event_id,is_paid,paid_externally,stage,mercadopago_payment_id,appmax_order_id,pagarme_order_id,austpay_transaction_id,selfservice_cashback_receipt,events(operation_mode)").eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!o || o.events?.operation_mode !== "whatsapp_autoatendimento") return { applicable: false };
  if (!(o.is_paid || o.paid_externally) || o.stage === "cancelled") throw new Error("Pedido ainda não pago");
  const { data: existing } = await sb.from("internal_cashback").select("coupon_code,cashback_amount,min_purchase,expires_at").eq("source_order_id", orderId).maybeSingle();
  if (existing) return { applicable: true, ...existing };
  let amount: number | null = null, paidAt: string | null = null, gateway = "", txId = "";
  const { data: parts, error: splitError } = await sb.from("payment_splits").select("status,charge_amount,gateway,gateway_tx_id,paid_at").eq("order_id", orderId).limit(20);
  if (splitError) throw splitError;
  const active = (parts || []).filter((p: any) => !["cancelled", "canceled", "refunded"].includes(p.status));
  if (active.length) {
    if (active.some((p: any) => p.status !== "paid" || !p.paid_at)) throw new Error("Partes ainda não confirmadas");
    amount = active.reduce((sum: number, p: any) => sum + Number(p.charge_amount), 0);
    paidAt = active.map((p: any) => p.paid_at).sort().at(-1);
    gateway = "split"; txId = active.map((p: any) => p.gateway_tx_id).join(",");
  } else if (o.mercadopago_payment_id) {
    const account = await getMpAccountForOrder(sb, orderId);
    if (!account || account.is_sandbox) throw new Error("Conta de produção indisponível");
    const response = await mpGetPayment(account.access_token, o.mercadopago_payment_id);
    if (!response.ok) throw new Error(`Conferência MP: ${response.status}`);
    const p = await response.json();
    if (String(p.id) !== String(o.mercadopago_payment_id) || p.status !== "approved" || p.currency_id !== "BRL") throw new Error("Pagamento MP não aprovado");
    amount = Number(p.transaction_amount); paidAt = p.date_approved || null;
    gateway = "mercadopago"; txId = String(p.id);
  } else if (o.appmax_order_id) {
    const result = await appmaxGetPayment(sb, String(o.appmax_order_id), null);
    if (result.kind !== "ok" || !APPMAX_PAID.includes(result.payment.status)) throw new Error("Pagamento Appmax não confirmado");
    amount = result.payment.amount; paidAt = result.payment.dateApproved;
    gateway = "appmax"; txId = result.payment.orderId;
  } else if (o.pagarme_order_id) {
    const key = Deno.env.get("PAGARME_SECRET_KEY");
    if (!key) throw new Error("Credencial Pagar.me indisponível");
    const response = await fetch(`https://api.pagar.me/core/v5/orders/${encodeURIComponent(o.pagarme_order_id)}`, { headers: { Authorization: `Basic ${btoa(key + ":")}` } });
    if (!response.ok) throw new Error(`Conferência Pagar.me: ${response.status}`);
    const p = await response.json();
    if (p.status !== "paid" || String(p.id) !== String(o.pagarme_order_id)) throw new Error("Pagamento Pagar.me não confirmado");
    const charges = (p.charges || []).filter((c: any) => c.status === "paid");
    amount = charges.reduce((s: number, c: any) => s + Number(c.paid_amount || c.amount), 0) / 100;
    paidAt = charges.map((c: any) => c.paid_at).filter(Boolean).sort().at(-1) || null;
    gateway = "pagarme"; txId = String(p.id);
  } else if (o.austpay_transaction_id) {
    const cfg = await resolveAustpayConfig(sb);
    if (!cfg || cfg.env !== "production") throw new Error("AustPay produção indisponível");
    const response = await austpayGetTransaction(cfg, o.austpay_transaction_id);
    if (!response.ok) throw new Error(`Conferência AustPay: ${response.status}`);
    const p = await response.json();
    if (p.status !== "APPROVED" || String(p.id || p.transaction_id) !== String(o.austpay_transaction_id) || p.external_reference !== orderId) throw new Error("AustPay sem captura válida");
    amount = Number(p.amount) / 100; paidAt = p.paid_at || p.approved_at || p.captured_at || null;
    gateway = "austpay"; txId = o.austpay_transaction_id;
  }
  if (!amount || !paidAt || !Number.isFinite(Date.parse(paidAt))) throw new Error("Cashback aguardando valor e horário oficiais do pagamento");
  const { data, error: grantError } = await sb.rpc("selfservice_grant_cashback", { p_order_id: orderId, p_amount_paid: amount, p_paid_at: paidAt, p_gateway: gateway, p_transaction_id: txId });
  if (grantError) throw grantError;
  return data;
}