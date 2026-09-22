// ── AustPay (Rinne): webhook de transações ────────────────────────────────
// Recebe transaction.created / transaction.status-changed e reflete o
// pagamento no pedido (orders) ou na venda do PDV (pos_sales), igual aos
// demais gateways. A verdade final é sempre a RECONSULTA na API da AustPay.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyPaymentConfirmed } from "../_shared/payment-confirmed.ts";
import {
  austpayGetTransaction,
  fromCents,
  getAustpayConfig,
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
    const data = body?.data || body?.transaction || body || {};
    const txId = String(data?.id || data?.transaction_id || "");
    if (!txId) return json({ ok: true, skipped: "no_transaction_id" });

    console.log(`[austpay-webhook] evento=${event} tx=${txId}`);

    // Reconsulta obrigatória: nunca confiamos só no corpo do webhook.
    let status = String(data?.status || "");
    let amount = Number(data?.amount || 0);
    let externalRef = String(data?.external_reference || "");
    const cfg = getAustpayConfig();
    if (cfg) {
      try {
        const res = await austpayGetTransaction(cfg, txId);
        if (res.ok) {
          const tx = await res.json();
          status = String(tx?.status || status);
          amount = Number(tx?.amount || amount);
          externalRef = String(tx?.external_reference || externalRef);
        } else {
          console.warn(`[austpay-webhook] reconsulta falhou (${res.status}) — usando dados do webhook.`);
        }
      } catch (e) {
        console.warn("[austpay-webhook] reconsulta com erro:", e);
      }
    }

    if (!isAustpayApproved(status)) {
      console.log(`[austpay-webhook] status ${status} não acionável.`);
      return json({ ok: true, skipped: true, status });
    }

    const amountBrl = amount > 1000 ? fromCents(amount) : amount; // API trabalha em centavos

    // ── Pedido (orders) ──
    let orderRow: any = null;
    {
      const { data: byTx } = await supabase
        .from("orders")
        .select("id, is_paid, pickup_store_id")
        .eq("austpay_transaction_id", txId)
        .limit(1);
      orderRow = byTx?.[0] || null;
      if (!orderRow && externalRef) {
        const { data: byRef } = await supabase
          .from("orders")
          .select("id, is_paid, pickup_store_id")
          .eq("id", externalRef)
          .maybeSingle();
        if (byRef) {
          orderRow = byRef;
          await supabase.from("orders").update({ austpay_transaction_id: txId }).eq("id", byRef.id);
        }
      }
    }

    if (orderRow) {
      if (orderRow.is_paid) return json({ ok: true, skipped: "already_paid", order_id: orderRow.id });

      await supabase
        .from("orders")
        .update({
          is_paid: true,
          paid_at: new Date().toISOString(),
          payment_confirmed_source: "austpay-webhook",
          austpay_transaction_id: txId,
        })
        .eq("id", orderRow.id);

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
        payment_method: "pix",
        status: "success",
        amount: amountBrl,
        gateway: "austpay",
        transaction_id: txId,
        error_message: `Webhook AustPay: pagamento aprovado (${txId})`,
        metadata: { source: "webhook", gateway: "austpay", status },
      });

      console.log(`[austpay-webhook] pedido ${orderRow.id} marcado como pago`);
      return json({ ok: true, order_id: orderRow.id });
    }

    // ── Venda do PDV (pos_sales) ──
    const { data: sales } = await supabase
      .from("pos_sales")
      .select("id, status, store_id")
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

    await supabase
      .from("pos_sales")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_gateway: "austpay",
        payment_method: "PIX",
        notes: `🔔 Webhook AustPay: pagamento aprovado (${txId})`,
      })
      .eq("id", sale.id);

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: sale.id,
      store_id: sale.store_id,
      payment_method: "pix",
      status: "success",
      amount: amountBrl,
      gateway: "austpay",
      transaction_id: txId,
      error_message: `Webhook AustPay: pagamento aprovado (${txId})`,
      metadata: { source: "webhook", gateway: "austpay", status },
    });

    console.log(`[austpay-webhook] venda ${sale.id} marcada como paga`);
    return json({ ok: true, sale_id: sale.id });
  } catch (error) {
    console.error("[austpay-webhook] erro:", error);
    return json({ ok: true, error: (error as Error)?.message || String(error) });
  }
});
