import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMpAccountByPaymentId, getMpAccountForOrder, getMpAccountForSale } from "../_shared/mp-account.ts";
import { normalizeGatewayPaymentLabel } from "../_shared/payment-method-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Backfill da forma de pagamento (PIX vs Cartão) e parcelas para pedidos
 * PAGOS que ainda não têm `payment_method_label` / `installments` preenchidos.
 *
 * Consulta diretamente as APIs dos gateways (Mercado Pago e Pagar.me) usando
 * os IDs de transação já salvos no pedido. Processa em lotes para não estourar
 * o tempo de execução.
 *
 * Body opcional:
 *  - limit: número máximo de pedidos por execução (padrão 150)
 *  - gateway: "mercadopago" | "pagarme" | "all" (padrão "all")
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }

  const limit = Math.min(Number(body.limit) || 150, 500);
  const gatewayFilter = String(body.gateway || "all").toLowerCase();

  const result = {
    mercadopago: { processed: 0, updated: 0, failed: 0 },
    pagarme: { processed: 0, updated: 0, failed: 0 },
  };

  // ---------------- Mercado Pago ----------------
  if (gatewayFilter === "all" || gatewayFilter === "mercadopago") {
    const { data: mpOrders } = await supabase
      .from("orders")
      .select("id, mercadopago_payment_id")
      .is("payment_method_label", null)
      .not("mercadopago_payment_id", "is", null)
      .or("is_paid.eq.true,paid_externally.eq.true")
      .limit(limit);

    for (const order of mpOrders || []) {
      result.mercadopago.processed++;
      try {
        const paymentId = String(order.mercadopago_payment_id);
        let account = await getMpAccountByPaymentId(supabase, paymentId);
        if (!account?.access_token) {
          account = (await getMpAccountForOrder(supabase, order.id)) ||
            (await getMpAccountForSale(supabase, order.id));
        }
        if (!account?.access_token) {
          result.mercadopago.failed++;
          continue;
        }

        const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${account.access_token}` },
        });
        if (!res.ok) {
          result.mercadopago.failed++;
          continue;
        }
        const pay = await res.json();
        const inst = Number(pay.installments || 1);
        const label = normalizeGatewayPaymentLabel({
          gateway: "mercadopago",
          paymentTypeId: String(pay.payment_type_id || ""),
          paymentMethodId: String(pay.payment_method_id || ""),
          installments: inst,
        });
        if (!label) {
          result.mercadopago.failed++;
          continue;
        }

        await supabase
          .from("orders")
          .update({ payment_method_label: label, installments: inst })
          .eq("id", order.id);
        result.mercadopago.updated++;
      } catch (err) {
        console.error("[backfill][mp]", order.id, (err as Error).message);
        result.mercadopago.failed++;
      }
    }
  }

  // ---------------- Pagar.me ----------------
  if (gatewayFilter === "all" || gatewayFilter === "pagarme") {
    const secretKey = Deno.env.get("PAGARME_SECRET_KEY") || "";
    if (secretKey) {
      const auth = btoa(`${secretKey}:`);
      const { data: pgOrders } = await supabase
        .from("orders")
        .select("id, pagarme_order_id")
        .is("payment_method_label", null)
        .not("pagarme_order_id", "is", null)
        .or("is_paid.eq.true,paid_externally.eq.true")
        .limit(limit);

      for (const order of pgOrders || []) {
        result.pagarme.processed++;
        try {
          const res = await fetch(
            `https://api.pagar.me/core/v5/orders/${order.pagarme_order_id}`,
            { headers: { Authorization: `Basic ${auth}` } },
          );
          if (!res.ok) {
            result.pagarme.failed++;
            continue;
          }
          const data = await res.json();
          const charge = data.charges?.[0];
          const lastTx = charge?.last_transaction;
          const inst = Number(lastTx?.installments || charge?.installments || 1);
          const label = normalizeGatewayPaymentLabel({
            gateway: "pagarme",
            paymentMethodId: String(charge?.payment_method || ""),
            installments: inst,
          });
          if (!label) {
            result.pagarme.failed++;
            continue;
          }
          await supabase
            .from("orders")
            .update({ payment_method_label: label, installments: inst })
            .eq("id", order.id);
          result.pagarme.updated++;
        } catch (err) {
          console.error("[backfill][pagarme]", order.id, (err as Error).message);
          result.pagarme.failed++;
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
