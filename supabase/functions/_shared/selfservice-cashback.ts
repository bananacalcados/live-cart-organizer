import { getMpAccountForOrder } from "./mp-account.ts";
import { mpGetPayment } from "./mp-http.ts";
import { appmaxGetPayment, APPMAX_PAID } from "./refund-gateways/appmax.ts";
import { resolveAustpayConfig, austpayGetTransaction } from "./austpay.ts";
import { capturedAustpayEvidence } from "./selfservice-payment-evidence.ts";
import { pickConfirmedGateway, canGrantWithoutGateway } from "./selfservice-cashback-rule.ts";

/** Verifies on the gateway that really approved; if verification fails on a system-paid order, grants from paid_at + paid value with a receipt note. */
export async function grantSelfserviceCashback(sb: any, orderId: string) {
  const { data: o, error } = await sb.from("orders").select("id,event_id,is_paid,paid_externally,stage,mercadopago_payment_id,appmax_order_id,pagarme_order_id,austpay_transaction_id,vindi_transaction_id,notes,products,discount_type,discount_value,shipping_cost,free_shipping,pos_sale_id,selfservice_cashback_receipt,paid_at,payment_confirmed_source,events(operation_mode)").eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!o || o.events?.operation_mode !== "whatsapp_autoatendimento") return { applicable: false };
  if (!(o.is_paid || o.paid_externally) || o.stage === "cancelled") throw new Error("Pedido ainda não pago");
  const { data: existing } = await sb.from("internal_cashback").select("coupon_code,cashback_amount,min_purchase,expires_at").eq("source_order_id", orderId).maybeSingle();
  if (existing) return { applicable: true, ...existing };
  let amount: number | null = null, paidAt: string | null = null, gateway = "", txId = "", note: string | null = null;
  const vpsParts: any[] = [];
  let gw: string | null = null;
  try {
    const { data: parts, error: splitError } = await sb.from("payment_splits").select("method,status,charge_amount,gateway,gateway_tx_id,paid_at").eq("order_id", orderId).limit(20);
    if (splitError) throw splitError;
    const { data: attempts } = await sb.from("pos_checkout_attempts").select("gateway,status,created_at").eq("sale_id", orderId).order("created_at", { ascending: false }).limit(20);
    gw = pickConfirmedGateway(o, attempts || []);
    // VPS não gera cashback: só as partes pagas por Pix/cartão contam.
    vpsParts.push(...(parts || []).filter((p: any) => p.method === "vps" && !["cancelled", "canceled", "refunded"].includes(p.status)));
    const active = (parts || []).filter((p: any) => !["cancelled", "canceled", "refunded"].includes(p.status) && p.method !== "vps");
    if (active.length) {
      if (active.length > 10 || active.some((p: any) => p.status !== "approved" || p.gateway !== "mercadopago" || !p.gateway_tx_id)) throw new Error("Partes ainda não confirmadas");
      const account = await getMpAccountForOrder(sb, orderId);
      if (!account || account.is_sandbox) throw new Error("Conta de produção indisponível");
      const payments = await Promise.all(active.map(async (part: any) => {
        const response = await mpGetPayment(account.access_token, part.gateway_tx_id);
        if (!response.ok) throw new Error("Não foi possível conferir uma das partes");
        const payment = await response.json();
        if (payment.status !== "approved" || payment.currency_id !== "BRL" || String(payment.id) !== String(part.gateway_tx_id) || !payment.date_approved) throw new Error("Parte sem comprovação");
        return payment;
      }));
      amount = payments.reduce((sum: number, payment: any) => sum + Number(payment.transaction_amount), 0);
      paidAt = payments.map((payment: any) => payment.date_approved).sort().at(-1);
      gateway = "split"; txId = active.map((p: any) => p.gateway_tx_id).join(",");
    } else if (gw === "mercadopago" && o.mercadopago_payment_id) {
      const account = await getMpAccountForOrder(sb, orderId);
      if (!account || account.is_sandbox) throw new Error("Conta de produção indisponível");
      const response = await mpGetPayment(account.access_token, o.mercadopago_payment_id);
      if (!response.ok) throw new Error(`Conferência MP: ${response.status}`);
      const p = await response.json();
      if (String(p.id) !== String(o.mercadopago_payment_id) || p.currency_id !== "BRL") throw new Error("Identidade do pagamento MP inválida");
      if (p.status === "approved") {
        amount = Number(p.transaction_amount); paidAt = p.date_approved || null;
        gateway = "mercadopago"; txId = String(p.id);
      }
    }
    if (!amount && gw === "austpay" && o.austpay_transaction_id) {
      const cfg = await resolveAustpayConfig(sb);
      if (!cfg || cfg.env !== "production") throw new Error("AustPay produção indisponível");
      const response = await austpayGetTransaction(cfg, o.austpay_transaction_id);
      if (!response.ok) throw new Error(`Conferência AustPay: ${response.status}`);
      const p = await response.json();
      const tx = p.status ? p : p.data || p;
      const { data: invalidated, error: invalidationError } = await sb.from("pos_checkout_attempts").select("id").eq("sale_id", orderId).eq("transaction_id", o.austpay_transaction_id).eq("status", "invalidated").limit(1);
      if (invalidationError || invalidated?.length) throw new Error("Captura AustPay invalidada ou não verificável");
      const evidence = capturedAustpayEvidence(tx, o.austpay_transaction_id, o.id, orderId);
      amount = evidence.amount; paidAt = evidence.paidAt;
      gateway = "austpay"; txId = o.austpay_transaction_id;
    }
    if (!amount && gw === "appmax" && o.appmax_order_id) {
      const result = await appmaxGetPayment(sb, String(o.appmax_order_id), null);
      if (result.kind !== "ok" || !APPMAX_PAID.includes(result.payment.status)) throw new Error("Pagamento Appmax não confirmado");
      amount = result.payment.amount;
      // Appmax não informa a hora da aprovação: vale a hora em que o webhook da Appmax nos avisou (orders.paid_at).
      paidAt = result.payment.dateApproved || (o.payment_confirmed_source === "gateway_webhook" ? o.paid_at : null);
      gateway = "appmax"; txId = result.payment.orderId;
    } else if (!amount && gw === "pagarme" && o.pagarme_order_id) {
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
    }
    if (!amount || !paidAt || !Number.isFinite(Date.parse(paidAt))) throw new Error(`sem valor/horário oficiais no gateway ${gw || "desconhecido"}`);
  } catch (e) {
    if (!canGrantWithoutGateway(o.payment_confirmed_source) || !o.paid_at) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    amount = await paidValue(sb, o, vpsParts); paidAt = o.paid_at;
    gateway = gw || o.payment_confirmed_source; txId = `sem_conferencia:${orderId}`;
    note = `concedido sem conferência de gateway: ${reason}`;
  }
  if (!amount || !paidAt || !Number.isFinite(Date.parse(paidAt))) throw new Error("Cashback aguardando valor e horário oficiais do pagamento");
  const { data, error: grantError } = await sb.rpc("selfservice_grant_cashback", { p_order_id: orderId, p_amount_paid: amount, p_paid_at: paidAt, p_gateway: gateway, p_transaction_id: txId });
  if (grantError) throw grantError;
  if (note) await sb.from("orders").update({ selfservice_cashback_receipt: { ...(await sb.from("orders").select("selfservice_cashback_receipt").eq("id", orderId).maybeSingle()).data?.selfservice_cashback_receipt, verification: "sem_conferencia_gateway", note } }).eq("id", orderId);
  return data;
}

/** Order paid value (sale total or items+shipping), minus VPS parts which never earn cashback. */
async function paidValue(sb: any, o: any, vpsParts: any[]): Promise<number> {
  let total = 0;
  if (o.pos_sale_id) {
    const { data } = await sb.from("pos_sales").select("total").eq("id", o.pos_sale_id).maybeSingle();
    total = Number(data?.total) || 0;
  }
  if (!total) {
    const sub = (Array.isArray(o.products) ? o.products : []).reduce((s: number, p: any) => s + (Number(p?.price) || 0) * (Number(p?.quantity) || 0), 0);
    const disc = o.discount_type && o.discount_value != null ? (o.discount_type === "percentage" ? sub * Number(o.discount_value) / 100 : Number(o.discount_value)) : 0;
    total = Math.max(0, sub - disc) + (o.free_shipping ? 0 : Number(o.shipping_cost) || 0);
  }
  const vps = vpsParts.reduce((s: number, p: any) => s + (Number(p.charge_amount) || 0), 0);
  const value = Math.round((total - vps) * 100) / 100;
  if (!(value > 0)) throw new Error("Pedido pago sem valor em dinheiro/cartão para cashback");
  return value;
}