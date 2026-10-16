// ── AustPay (Rinne): webhook de transações ────────────────────────────────
// Recebe transaction.created / transaction.status-changed e reflete o
// pagamento no pedido (orders) ou na venda do PDV (pos_sales), igual aos
// demais gateways. A verdade final é sempre a RECONSULTA na API da AustPay.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyPaymentConfirmed } from "../_shared/payment-confirmed.ts";
import { validAustpayPaymentProof } from "../_shared/payment-proof.ts";
import {
  austpayGetTransaction,
  fromCents,
  getAustpayConfig, resolveAustpayConfig,
  isAustpayApproved,
} from "../_shared/austpay.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Valida a assinatura HMAC-SHA256 do corpo cru. Sem segredo configurado → passa. */
async function validSignature(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get("AUSTPAY_WEBHOOK_SECRET");
  if (!secret) return true;
  const header = req.headers.get("x-signature") || req.headers.get("x-rinne-signature") || "";
  if (!header) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return header.toLowerCase().includes(hex);
  } catch (e) {
    console.error("[austpay-webhook] erro ao validar assinatura:", e);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const raw = await req.text();
    let body: any = {};
    try { body = JSON.parse(raw || "{}"); } catch { body = {}; }

    if (!(await validSignature(req, raw))) {
      console.warn("[austpay-webhook] assinatura inválida — descartando.");
      return json({ ok: true, skipped: "bad_signature" });
    }

    const event = String(body?.event || body?.type || "");
    // Formato oficial (docs Rinne): { id: <id do EVENTO>, type, payload: { transaction_id, old_status, new_status } }.
    // Nunca usar body.id como transação — é o id do evento.
    const p = body?.payload || {};
    const data = body?.data || body?.transaction || {};
    const txId = String(p?.transaction_id || data?.transaction_id || data?.id || "");
    if (p?.new_status && !data?.status) data.status = p.new_status;
    if (!txId) return json({ ok: true, skipped: "no_transaction_id" });

    console.log(`[austpay-webhook] evento=${event} tx=${txId}`);

    // Reconsulta obrigatória: nunca confiamos só no corpo do webhook.
    const cfg = await resolveAustpayConfig(supabase);
    if (!cfg || cfg.env !== "production") return json({ ok: false, skipped: "production_required" }, 503);
    const res = await austpayGetTransaction(cfg, txId);
    if (!res.ok) return json({ ok: false, skipped: "transaction_unverified" }, 503);
    const tx = await res.json();
    const status = String(tx?.status || "");
    const amount = Number(tx?.amount || 0);
    const externalRef = String(tx?.external_reference || "");
    const { data: invalidated, error: invalidationError } = await supabase.from("pos_checkout_attempts")
      .select("id").eq("sale_id", externalRef).eq("transaction_id", txId).eq("status", "invalidated").limit(1);
    if (invalidationError) return json({ ok: false, skipped: "invalidation_unverified" }, 503);
    if (invalidated?.length) return json({ ok: true, skipped: "invalidated_transaction" });
    if (status !== "APPROVED") {
      return json({ ok: true, skipped: "not_captured", status });
    }

    if (!isAustpayApproved(status)) {
      console.log(`[austpay-webhook] status ${status} não acionável.`);
      return json({ ok: true, skipped: true, status });
    }

    const amountBrl = fromCents(amount);

    // ── Pedido (orders) ──
    let orderRow: any = null;
    {
      const { data: byTx } = await supabase
        .from("orders")
        .select("id, is_paid, pickup_store_id, stage, products, discount_type, discount_value, shipping_cost, free_shipping")
        .eq("austpay_transaction_id", txId)
        .limit(1);
      orderRow = byTx?.[0] || null;
      if (!orderRow && externalRef) {
        const { data: byRef } = await supabase
          .from("orders")
          .select("id, is_paid, pickup_store_id, stage, products, discount_type, discount_value, shipping_cost, free_shipping")
          .eq("id", externalRef)
          .maybeSingle();
        if (byRef) {
          orderRow = byRef;
        }
      }
    }

    if (orderRow) {
      if (orderRow.is_paid) return json({ ok: true, skipped: "already_paid", order_id: orderRow.id });
      if (orderRow.stage === "cancelled") return json({ ok: true, skipped: "cancelled_order" });
      const subtotal = (orderRow.products || []).reduce((sum: number, item: any) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
      const discount = orderRow.discount_type === "percentage" ? subtotal * Number(orderRow.discount_value || 0) / 100 : Number(orderRow.discount_value || 0);
      const expectedAmountCents = Math.round((subtotal - discount + (orderRow.free_shipping ? 0 : Number(orderRow.shipping_cost || 0))) * 100);
      if (!validAustpayPaymentProof({ environment: cfg.env, responseOk: res.ok, transactionId: String(tx.id || tx.transaction_id || ""), expectedTransactionId: txId, reference: externalRef, expectedReference: orderRow.id, status, amountCents: amount, expectedAmountCents })) {
        return json({ ok: true, skipped: "payment_proof_mismatch" });
      }

      const { data: changedOrder, error: updateError } = await supabase
        .from("orders")
        .update({
          is_paid: true,
          paid_at: new Date().toISOString(),
          payment_confirmed_source: "austpay-webhook",
          austpay_transaction_id: txId,
        })
        .eq("id", orderRow.id).eq("is_paid", false).neq("stage", "cancelled").select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!changedOrder) return json({ ok: true, skipped: "unchanged" });

      let loja = "centro";
      if (orderRow.pickup_store_id) {
        const { data: store } = await supabase
          .from("pos_stores").select("name").eq("id", orderRow.pickup_store_id).maybeSingle();
        if (store?.name) loja = String(store.name).toLowerCase();
      }
      await notifyPaymentConfirmed({
        pedido_id: orderRow.id,
        loja,
        gateway: "austpay",
        transaction_id: txId,
        source: "austpay-webhook",
      });

      await supabase.from("pos_checkout_attempts").insert({
        sale_id: orderRow.id,
        payment_method: String(tx.payment_method || "credit_card"),
        status: "success",
        amount: amountBrl,
        gateway: "austpay",
        transaction_id: txId,
        error_message: `Webhook AustPay: pagamento aprovado (${txId})`,
        metadata: { source: "webhook", gateway: "austpay", status, payment_environment: cfg.env },
      });

      console.log(`[austpay-webhook] pedido ${orderRow.id} marcado como pago`);
      return json({ ok: true, order_id: orderRow.id });
    }

    // ── Venda do PDV (pos_sales) ──
    const { data: sales } = await supabase
      .from("pos_sales")
      .select("id, status, store_id, total")
      .eq("austpay_transaction_id", txId)
      .limit(1);
    const sale = sales?.[0] || null;

    if (!sale) {
      console.log(`[austpay-webhook] nenhum pedido/venda para tx=${txId}`);
      return json({ ok: true, skipped: "not_found" });
    }
    if (sale.status === "paid" || sale.status === "completed") {
      return json({ ok: true, skipped: "already_paid", sale_id: sale.id });
    }
    if (sale.status === "cancelled") return json({ ok: true, skipped: "cancelled_sale" });
    if (!validAustpayPaymentProof({ environment: cfg.env, responseOk: res.ok, transactionId: String(tx.id || tx.transaction_id || ""), expectedTransactionId: txId, reference: externalRef, expectedReference: sale.id, status, amountCents: amount, expectedAmountCents: Math.round(Number(sale.total) * 100) })) {
      return json({ ok: true, skipped: "payment_proof_mismatch" });
    }

    const { data: changedSale, error: saleError } = await supabase
      .from("pos_sales")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_gateway: "austpay",
        payment_method: tx.payment_method === "PIX" ? "PIX" : "Cartão de Crédito",
        notes: `🔔 Webhook AustPay: pagamento aprovado (${txId})`,
      })
      .eq("id", sale.id).not("status", "in", '("paid","completed","cancelled")').select("id").maybeSingle();
    if (saleError) throw saleError;
    if (!changedSale) return json({ ok: true, skipped: "unchanged" });

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: sale.id,
      store_id: sale.store_id,
      payment_method: String(tx.payment_method || "credit_card"),
      status: "success",
      amount: amountBrl,
      gateway: "austpay",
      transaction_id: txId,
      error_message: `Webhook AustPay: pagamento aprovado (${txId})`,
      metadata: { source: "webhook", gateway: "austpay", status, payment_environment: cfg.env },
    });

    console.log(`[austpay-webhook] venda ${sale.id} marcada como paga`);
    return json({ ok: true, sale_id: sale.id });
  } catch (error) {
    console.error("[austpay-webhook] erro:", error);
    return json({ ok: false, error: "Não foi possível verificar o pagamento." }, 503);
  }
});
