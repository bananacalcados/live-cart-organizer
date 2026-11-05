import { withAccessLog } from "../_shared/withAccessLog.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyPaymentConfirmed } from "../_shared/payment-confirmed.ts";
import { normalizeGatewayPaymentLabel, syncOrderPaymentToPosSale } from "../_shared/payment-method-sync.ts";
import { type Decision, alreadyApplied, posAmountOk, expectedOrderAmounts, flagReview, hmacHex, isStrictMode, logVerification, observeSignature, orderAmountOk, pagarmeLookup, requestIp, securityEvent, warnMissingSecretOncePerDay } from "../_shared/webhook-verification.ts";

// REGRA DE NEGÓCIO (NÃO REATIVAR SEM AUTORIZAÇÃO DO USUÁRIO):
// Criação automática de pedidos na Shopify está DESABILITADA em TODAS as situações
// (eventos site, eventos loja, pagamentos via PIX/cartão, webhooks de gateway).
async function autoCreateShopifyOrder(_supabase: any, orderId: string, source: string, _supabaseUrl: string, _supabaseKey: string) {
  console.log(`[AUTO-SHOPIFY] DISABLED — skip ${source} ${orderId}`);
  return;
}

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

// Tiny ERP desativado — criação automática de pedido no Tiny removida (no-op).
async function autoCreateTinyOrder(_supabase: any, _saleId: string, _supabaseUrl: string, _supabaseKey: string) {
  return;
}

serve(withAccessLog("pagarme-webhook", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const rawBody = await req.text();
    const ip = requestIp(req);
    // Assinatura (x-hub-signature = sha1=HMAC do corpo) quando o segredo existe.
    const whSecret = Deno.env.get("PAGARME_WEBHOOK_SECRET");
    if (whSecret) {
      const sig = (req.headers.get("x-hub-signature") || "").replace(/^sha1=/, "");
      const calc = await hmacHex("SHA-1", whSecret, rawBody);
      const reject = await observeSignature(supabase, "pagarme", !!sig && sig === calc, ip);
      if (reject) {
        return new Response(JSON.stringify({ ok: false, error: "bad_signature" }), { status: 401, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
      }
    } else {
      await warnMissingSecretOncePerDay(supabase, "pagarme");
    }
    const payload = JSON.parse(rawBody || "{}");
    console.log("Pagar.me webhook received:", JSON.stringify(payload).substring(0, 1000));

    const eventType = payload.type || payload.event;
    const orderData = payload.data;
    if (!orderData) {
      console.log("No data in payload, ignoring");
      return new Response(JSON.stringify({ ok: true }), { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    const ourOrderId = orderData.code || orderData.metadata?.our_order_id;
    const pagarmeOrderId = orderData.id;
    const status = orderData.status;
    const chargeObj = orderData.charges?.[0];
    const transactionId = chargeObj?.last_transaction?.id || pagarmeOrderId;

    console.log(`Event: ${eventType}, Status: ${status}, OurOrderId: ${ourOrderId}, PagarmeId: ${pagarmeOrderId}`);

    if (!ourOrderId) {
      console.log("No order code/metadata found, cannot map to internal order. Skipping.");
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    const isPaid = status === "paid" || eventType === "order.paid" || eventType === "charge.paid";
    const isFailed = status === "failed" || status === "canceled" || eventType === "order.payment_failed" || eventType === "order.canceled";

    if (!isPaid && !isFailed) {
      console.log(`Status "${status}" / event "${eventType}" is not actionable, skipping.`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    // Strategy 1: Search by pagarme_order_id (gateway link field)
    let order: any = null;
    let sale: any = null;
    let orderSource: string | null = null;

    const { data: orderByGateway } = await supabase
      .from("orders")
      .select("id, is_paid, notes")
      .eq("pagarme_order_id", String(ourOrderId))
      .maybeSingle();

    if (orderByGateway) {
      order = orderByGateway;
      orderSource = "orders";
      console.log(`[pagarme] Found order ${order.id} via pagarme_order_id`);
    } else {
      const { data: saleByGateway } = await supabase
        .from("pos_sales")
        .select("id, status")
        .eq("pagarme_order_id", String(ourOrderId))
        .maybeSingle();

      if (saleByGateway) {
        sale = saleByGateway;
        orderSource = "pos_sales";
        console.log(`[pagarme] Found pos_sale ${sale.id} via pagarme_order_id`);
      }
    }

    // Strategy 2 (fallback): Search by internal id
    if (!orderSource) {
      const { data: orderById } = await supabase
        .from("orders")
        .select("id, is_paid, notes")
        .eq("id", ourOrderId)
        .maybeSingle();

      if (orderById) {
        order = orderById;
        orderSource = "orders";
        console.log(`[pagarme] Found order ${order.id} via internal id`);
      } else {
        const { data: saleById } = await supabase
          .from("pos_sales")
          .select("id, status")
          .eq("id", ourOrderId)
          .maybeSingle();

        if (saleById) {
          sale = saleById;
          orderSource = "pos_sales";
          console.log(`[pagarme] Found pos_sale ${sale.id} via internal id`);
        }
      }
    }

    let updated = false;
    const resolvedOrderId = order?.id || sale?.id || ourOrderId;

    // ── Verificação independente (Fase 3) ──
    const alreadyPaid = (order && order.is_paid) || (sale && (sale.status === "paid" || sale.status === "completed"));
    if (isPaid && orderSource && !alreadyPaid) {
      const strict = await isStrictMode(supabase);
      const api = await pagarmeLookup(String(pagarmeOrderId || ourOrderId));
      let decision: Decision = "confirm";
      let reason = "";
      let expected: number | null = null;
      if (!api.found || !api.paid) { decision = "reject_unverified"; reason = api.error || `api_status=${api.status}`; }
      else if (orderSource === "orders") {
        const exp = await expectedOrderAmounts(supabase, order.id);
        expected = exp?.min ?? null;
        if (!exp || !orderAmountOk(api.amount || 0, exp)) { decision = "reject_amount"; reason = `api=${api.amount} esperado>=${exp?.min}`; }
      } else {
        const { data: s } = await supabase.from("pos_sales").select("total").eq("id", sale.id).maybeSingle();
        expected = Number(s?.total || 0);
        if (!posAmountOk(api.amount || 0, expected)) { decision = "reject_amount"; reason = `api=${api.amount} total=${expected}`; }
      }
      if (strict && decision === "confirm" && await alreadyApplied(supabase, "pagarme", String(transactionId))) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "duplicate_tx" }), { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
      }
      await logVerification(supabase, {
        provider: "pagarme", event_type: eventType, external_id: String(pagarmeOrderId || ""), transaction_id: String(transactionId),
        order_id: order?.id ?? null, sale_id: sale?.id ?? null, verified: api.found && api.paid, api_status: api.status,
        api_amount: api.amount, expected_amount: expected, old_decision: "confirm", new_decision: decision, reason,
        strict_mode: strict, applied: strict ? decision === "confirm" : true, details: { ip },
      });
      if (decision !== "confirm") {
        await securityEvent(supabase, decision === "reject_amount" ? "amount_mismatch" : "webhook_unverified", ip, {
          provider: "pagarme", order_id: order?.id, sale_id: sale?.id, pagarme_id: pagarmeOrderId, api_amount: api.amount, expected, strict,
        });
        if (strict) {
          if (decision === "reject_amount") await flagReview(supabase, orderSource as any, resolvedOrderId);
          return new Response(JSON.stringify({ ok: true, verified: false, reason: decision }), { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
        }
      }
    }

    if (orderSource === "orders" && order) {
      // Guard: already paid
      if (isPaid && order.is_paid === true) {
        console.log(`[pagarme] Pedido ${order.id} já confirmado — ignorando.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (isPaid && !order.is_paid) {
        // Captura forma de pagamento + parcelas a partir da cobrança Pagar.me
        const chargeMethod = String(chargeObj?.payment_method || "");
        const lastTx = chargeObj?.last_transaction || {};
        const inst = Number(lastTx.installments || chargeObj?.installments || 1);
        const payLabel =
          chargeMethod === "pix"
            ? "PIX"
            : chargeMethod === "credit_card"
              ? (inst > 1 ? `Cartão de Crédito ${inst}x` : "Cartão de Crédito")
              : chargeMethod === "debit_card"
                ? "Cartão de Débito"
                : chargeMethod === "boleto"
                  ? "Boleto"
                  : (chargeMethod ? chargeMethod.toUpperCase() : null);

        const paidAt = new Date().toISOString();
        const { error } = await supabase
          .from("orders")
          .update({
            is_paid: true, payment_confirmed_source: 'gateway_webhook',
            paid_at: paidAt,
            stage: "paid",
            pagarme_order_id: String(ourOrderId),
            ...(payLabel ? { payment_method_label: payLabel, installments: inst } : {}),
            notes: `${order.notes || ""}\n🔔 Webhook Pagar.me: pago (${transactionId})`.trim(),
          })
          .eq("id", order.id);

        if (error) console.error("Error updating orders:", error);
        else {
          updated = true;
          console.log(`orders ${order.id} marked as paid via webhook`);
          await syncOrderPaymentToPosSale(supabase, {
            orderId: order.id,
            paymentMethodLabel: payLabel,
            installments: inst,
            paymentGateway: "pagarme",
            transactionField: "pagarme_order_id",
            transactionValue: String(ourOrderId),
            paidAt,
          });
          await notifyPaymentConfirmed({
            pedido_id: order.id,
            loja: 'centro',
            gateway: 'pagarme',
            transaction_id: String(transactionId),
            source: 'pagarme-webhook',
          });
          // Auto-create Shopify order
          await autoCreateShopifyOrder(supabase, order.id, "orders", supabaseUrl, supabaseKey);
        }
      }
    } else if (orderSource === "pos_sales" && sale) {
      // Guard: already paid
      if (isPaid && (sale.status === "paid" || sale.status === "completed")) {
        console.log(`[pagarme] pos_sale ${sale.id} já confirmado — ignorando.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (isPaid && sale.status !== "paid" && sale.status !== "completed") {
        const paymentLabel = normalizeGatewayPaymentLabel({
          gateway: "pagarme",
          paymentMethodId: String(chargeObj?.payment_method || ""),
          installments: Number(chargeObj?.last_transaction?.installments || chargeObj?.installments || 1),
        }) || "Cartão de Crédito";
        const { error } = await supabase
          .from("pos_sales")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            payment_gateway: "pagarme",
            payment_method: (sale as any).payment_method || paymentLabel,
            pagarme_order_id: String(ourOrderId),
            notes: `🔔 Webhook Pagar.me: pago (${transactionId})`,
          })
          .eq("id", sale.id);
        if (error) console.error("Error updating pos_sales:", error);
        else {
          updated = true;
          console.log(`pos_sales ${sale.id} marked as paid via webhook`);
          // Tiny order creation is now MANUAL ONLY (via the "Enviar/Reenviar ao Tiny" button).
        }
      } else if (isFailed && sale.status === "online_pending") {
        const { error } = await supabase
          .from("pos_sales")
          .update({
            status: "payment_failed",
            payment_gateway: "pagarme",
            notes: `🔔 Webhook Pagar.me: ${status} (${chargeObj?.last_transaction?.acquirer_message || eventType})`,
          })
          .eq("id", sale.id);
        if (error) console.error("Error updating pos_sales to payment_failed:", error);
        else { updated = true; console.log(`pos_sales ${sale.id} marked as payment_failed via webhook`); }
      }
    } else {
      console.log(`Order ${ourOrderId} not found in orders or pos_sales`);
    }

    // Log to pos_checkout_attempts (skip if success record already exists for this sale)
    const logStatus = isPaid ? "success" : "error";
    const logMessage = isPaid
      ? `Webhook: pagamento confirmado (${transactionId})`
      : `Webhook: pagamento ${status} - ${chargeObj?.last_transaction?.acquirer_message || eventType}`;

    let skipInsert = false;
    if (isPaid) {
      const { data: existing } = await supabase
        .from("pos_checkout_attempts")
        .select("id")
        .eq("sale_id", resolvedOrderId)
        .eq("status", "success")
        .eq("payment_method", "credit_card")
        .limit(1);
      if (existing && existing.length > 0) {
        skipInsert = true;
        console.log(`Skipping duplicate checkout attempt for sale ${resolvedOrderId} - success already logged`);
      }
    }

    if (!skipInsert) {
      await supabase.from("pos_checkout_attempts").insert({
        sale_id: resolvedOrderId,
        payment_method: "credit_card",
        status: logStatus,
        error_message: logMessage,
        gateway: "pagarme",
        transaction_id: String(transactionId),
        metadata: { source: "webhook", event: eventType, pagarme_status: status },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, updated }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("pagarme-webhook error:", error);
    return new Response(
      JSON.stringify({ ok: true, error: error.message }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
}));
