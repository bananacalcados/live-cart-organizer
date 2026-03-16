import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function autoCreateShopifyOrder(_supabase: any, orderId: string, source: string, supabaseUrl: string, supabaseKey: string) {
  try {
    if (source !== "orders") return;
    console.log(`[AUTO-SHOPIFY] Creating Shopify order for ${source} ${orderId}...`);
    const res = await fetch(`${supabaseUrl}/functions/v1/shopify-create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    console.log(`[AUTO-SHOPIFY] Result:`, JSON.stringify(data).substring(0, 500));
  } catch (err: any) {
    console.error(`[AUTO-SHOPIFY] Error (non-blocking):`, err.message || err);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function autoCreateTinyOrder(supabase: any, saleId: string, supabaseUrl: string, supabaseKey: string) {
  try {
    const { data: sale } = await supabase
      .from("pos_sales")
      .select("store_id, customer_name, customer_phone, payment_details, tiny_order_id")
      .eq("id", saleId)
      .maybeSingle();

    if (!sale || !sale.store_id) {
      console.log(`[AUTO-TINY] No store_id for sale ${saleId}, skipping`);
      return;
    }
    if (sale.tiny_order_id) {
      console.log(`[AUTO-TINY] Sale ${saleId} already has tiny_order_id=${sale.tiny_order_id}, skipping`);
      return;
    }

    const { data: saleItems } = await supabase
      .from("pos_sale_items")
      .select("*")
      .eq("sale_id", saleId);

    if (!saleItems || saleItems.length === 0) {
      console.log(`[AUTO-TINY] No items for sale ${saleId}, skipping`);
      return;
    }

    const pd = sale.payment_details || {};
    const tinyCustomer: any = {
      name: pd.customer_name || sale.customer_name || "Consumidor Final",
      cpf: pd.customer_cpf || "",
      email: pd.customer_email || "",
      whatsapp: pd.customer_phone || sale.customer_phone || "",
      address: pd.address_street || "",
      addressNumber: pd.address_number || "",
      neighborhood: pd.address_neighborhood || "",
      city: pd.address_city || "",
      state: pd.address_state || "",
      cep: pd.address_cep || "",
    };

    const tinyItems = saleItems.map((it: any) => ({
      sku: it.sku || "",
      name: it.product_name,
      variant: it.variant_name || null,
      quantity: it.quantity,
      price: Number(it.unit_price),
      barcode: it.barcode || null,
      tiny_id: it.tiny_product_id || null,
    }));

    // Build payment method label from payment_details
    const installments = pd.installments || 1;
    const paymentMethodLabel = pd.payment_method === "credit_card"
      ? (installments > 1 ? `Cartão de Crédito ${installments}x` : "Cartão de Crédito")
      : pd.payment_method === "pix" ? "PIX" : undefined;

    const tinyPayload = {
      store_id: sale.store_id,
      sale_id: saleId,
      customer: tinyCustomer,
      items: tinyItems,
      payment_method_name: paymentMethodLabel,
      notes: "Checkout online - webhook",
    };

    console.log(`[AUTO-TINY] Creating Tiny order for sale ${saleId}...`);
    const tinyRes = await fetch(
      `${supabaseUrl}/functions/v1/pos-tiny-create-sale`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(tinyPayload),
      }
    );
    const tinyData = await tinyRes.json();
    console.log(`[AUTO-TINY] Result:`, JSON.stringify(tinyData).substring(0, 500));
  } catch (err) {
    console.error(`[AUTO-TINY] Error (non-blocking):`, err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const payload = await req.json();
    console.log("Pagar.me webhook received:", JSON.stringify(payload).substring(0, 1000));

    const eventType = payload.type || payload.event;
    const orderData = payload.data;
    if (!orderData) {
      console.log("No data in payload, ignoring");
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ourOrderId = orderData.code || orderData.metadata?.our_order_id;
    const pagarmeOrderId = orderData.id;
    const status = orderData.status;
    const chargeObj = orderData.charges?.[0];
    const transactionId = chargeObj?.last_transaction?.id || pagarmeOrderId;

    console.log(`Event: ${eventType}, Status: ${status}, OurOrderId: ${ourOrderId}, PagarmeId: ${pagarmeOrderId}`);

    if (!ourOrderId) {
      console.log("No order code/metadata found, cannot map to internal order. Skipping.");
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isPaid = status === "paid" || eventType === "order.paid" || eventType === "charge.paid";
    const isFailed = status === "failed" || status === "canceled" || eventType === "order.payment_failed" || eventType === "order.canceled";

    if (!isPaid && !isFailed) {
      console.log(`Status "${status}" / event "${eventType}" is not actionable, skipping.`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    if (orderSource === "orders" && order) {
      // Guard: already paid
      if (isPaid && order.is_paid === true) {
        console.log(`[pagarme] Pedido ${order.id} já confirmado — ignorando.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (isPaid && !order.is_paid) {
        const { error } = await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
            pagarme_order_id: String(ourOrderId),
            notes: `${order.notes || ""}\n🔔 Webhook Pagar.me: pago (${transactionId})`.trim(),
          })
          .eq("id", order.id);
        if (error) console.error("Error updating orders:", error);
        else {
          updated = true;
          console.log(`orders ${order.id} marked as paid via webhook`);
          // Notify Livete agent
          fetch(Deno.env.get('AGENTE2_PAGAMENTO_CONFIRMADO') || 'https://api.bananacalcados.com.br/webhook/pagamento-confirmado', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pedido_id: order.id, loja: 'centro', gateway: 'pagarme', transaction_id: String(transactionId) }),
          }).catch(err => console.error('Livete webhook error:', err));
          // Auto-create Shopify order
          await autoCreateShopifyOrder(supabase, order.id, "orders", supabaseUrl, supabaseKey);
        }
      }
    } else if (orderSource === "pos_sales" && sale) {
      // Guard: already paid
      if (isPaid && (sale.status === "paid" || sale.status === "completed")) {
        console.log(`[pagarme] pos_sale ${sale.id} já confirmado — ignorando.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (isPaid && sale.status !== "paid" && sale.status !== "completed") {
        const { error } = await supabase
          .from("pos_sales")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            payment_gateway: "pagarme",
            pagarme_order_id: String(ourOrderId),
            notes: `🔔 Webhook Pagar.me: pago (${transactionId})`,
          })
          .eq("id", sale.id);
        if (error) console.error("Error updating pos_sales:", error);
        else {
          updated = true;
          console.log(`pos_sales ${sale.id} marked as paid via webhook`);
          await autoCreateTinyOrder(supabase, sale.id, supabaseUrl, supabaseKey);
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

    // Log to pos_checkout_attempts
    const logStatus = isPaid ? "success" : "error";
    const logMessage = isPaid
      ? `Webhook: pagamento confirmado (${transactionId})`
      : `Webhook: pagamento ${status} - ${chargeObj?.last_transaction?.acquirer_message || eventType}`;

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: resolvedOrderId,
      payment_method: "credit_card",
      status: logStatus,
      error_message: logMessage,
      gateway: "pagarme",
      transaction_id: String(transactionId),
      metadata: { source: "webhook", event: eventType, pagarme_status: status },
    });

    return new Response(
      JSON.stringify({ ok: true, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("pagarme-webhook error:", error);
    return new Response(
      JSON.stringify({ ok: true, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
