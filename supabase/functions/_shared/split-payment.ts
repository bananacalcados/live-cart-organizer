// Pagamento dividido: finalização compartilhada (checkout + webhook).
// O pedido só vira pago quando TODAS as partes estão aprovadas.
import { notifyPaymentConfirmed } from "./payment-confirmed.ts";
import { syncOrderPaymentToPosSale } from "./payment-method-sync.ts";

export const SPLIT_REF_PREFIX = "split:";

const LABEL: Record<string, string> = { pix: "Pix", credit: "Crédito", debit: "Débito" };
const brl = (v: number) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

export function describeSplitRows(rows: any[]): string {
  return rows
    .sort((a, b) => a.seq - b.seq)
    .map((r) => `${LABEL[r.method] || r.method} ${brl(r.charge_amount)}${r.method === "credit" && r.installments > 1 ? ` ${r.installments}x` : ""}`)
    .join(" + ");
}

export async function splitPaymentEnabled(supabase: any): Promise<boolean> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "split_payment_enabled").maybeSingle();
  const v = data?.value;
  return v === true || v === "true";
}

/**
 * Registra a parte como aprovada (idempotente) e, se cobriu o total,
 * marca o pedido/venda como pago pelo caminho existente.
 */
export async function approveSplitPart(
  supabase: any,
  splitId: string,
  gateway: string,
  txId: string,
): Promise<{ fully_paid: boolean; paid_parts: number; parts: number; finalized: boolean }> {
  const { data: res, error } = await supabase.rpc("apply_split_payment", {
    _split_id: splitId, _gateway: gateway, _tx_id: txId,
  });
  if (error) throw new Error(`apply_split_payment: ${error.message}`);
  const out = { fully_paid: !!res?.fully_paid, paid_parts: res?.paid_parts ?? 0, parts: res?.parts ?? 0, finalized: false };
  if (!out.fully_paid) return out;

  const { data: part } = await supabase.from("payment_splits").select("order_id, sale_id").eq("id", splitId).maybeSingle();
  if (!part) return out;
  const q = supabase.from("payment_splits").select("*");
  const { data: rows } = part.order_id ? await q.eq("order_id", part.order_id) : await q.eq("sale_id", part.sale_id);
  const all = rows || [];
  const label = `Dividido: ${describeSplitRows(all)}`;
  const paidAt = new Date().toISOString();
  const details = all.sort((a: any, b: any) => a.seq - b.seq).map((r: any) => ({
    seq: r.seq, method: r.method, amount: r.amount, discount: r.discount_amount, charged: r.charge_amount,
    installments: r.installments, gateway: r.gateway, tx_id: r.gateway_tx_id, paid_at: r.paid_at,
  }));

  if (part.order_id) {
    const { data: upd } = await supabase
      .from("orders")
      .update({ is_paid: true, payment_confirmed_source: "gateway_webhook", paid_at: paidAt, stage: "paid", payment_method_label: label })
      .eq("id", part.order_id)
      .eq("is_paid", false)
      .select("id");
    if (upd && upd.length) {
      out.finalized = true;
      await syncOrderPaymentToPosSale(supabase, {
        orderId: part.order_id, paymentMethodLabel: label, paymentGateway: "mercadopago", paidAt,
      });
      const { data: o } = await supabase.from("orders").select("pos_sale_id").eq("id", part.order_id).maybeSingle();
      if (o?.pos_sale_id) await mergeDetails(supabase, o.pos_sale_id, details);
      await notifyPaymentConfirmed({ pedido_id: part.order_id, gateway: "split", transaction_id: txId, source: "split_payment" });
    }
  } else {
    const { data: upd } = await supabase
      .from("pos_sales")
      .update({ status: "paid", paid_at: paidAt, payment_gateway: "mercadopago", payment_method: label, notes: `💳 ${label}` })
      .eq("id", part.sale_id)
      .not("status", "in", '("paid","completed")')
      .select("id");
    if (upd && upd.length) {
      out.finalized = true;
      await mergeDetails(supabase, part.sale_id, details);
    }
  }
  return out;
}

async function mergeDetails(supabase: any, saleId: string, details: any[]) {
  const { data } = await supabase.from("pos_sales").select("payment_details").eq("id", saleId).maybeSingle();
  const cur = (data?.payment_details && typeof data.payment_details === "object") ? data.payment_details : {};
  await supabase.from("pos_sales").update({ payment_details: { ...cur, split_payment: details } }).eq("id", saleId);
}
