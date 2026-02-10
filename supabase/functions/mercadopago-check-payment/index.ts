import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function createShopifyOrder(
  order: Record<string, unknown>,
  customer: Record<string, unknown> | null,
) {
  const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

  if (!shopifyDomain || !shopifyToken) {
    console.log("Shopify credentials not configured, skipping order creation");
    return null;
  }

  const products = order.products as Array<{
    shopifyId: string;
    title: string;
    variant: string;
    price: number;
    quantity: number;
    sku?: string;
  }>;

  const lineItems = products.map((p) => {
    const variantIdMatch = p.shopifyId?.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
    if (variantIdMatch) {
      return { variant_id: parseInt(variantIdMatch[1]), quantity: p.quantity, price: p.price.toFixed(2) };
    }
    return { title: p.title, quantity: p.quantity, price: p.price.toFixed(2) };
  });

  let discountAmount = 0;
  const subtotal = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  if (order.discount_type && order.discount_value) {
    const dv = order.discount_value as number;
    discountAmount = order.discount_type === "percentage" ? subtotal * (dv / 100) : dv;
  }

  const shopifyOrder: Record<string, unknown> = {
    order: {
      line_items: lineItems,
      financial_status: "paid",
      note: `Pedido pago via PIX (Mercado Pago) - CRM Order #${(order.id as string).substring(0, 8)}`,
      tags: "pix,crm,mercadopago",
      ...(customer
        ? {
            customer: { first_name: (customer.instagram_handle as string) || "Cliente" },
            phone: (customer.whatsapp as string) || undefined,
          }
        : {}),
      ...(discountAmount > 0
        ? { discount_codes: [{ code: "CRM-DISCOUNT", amount: discountAmount.toFixed(2), type: "fixed_amount" }] }
        : {}),
    },
  };

  try {
    const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/orders.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
      body: JSON.stringify(shopifyOrder),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Shopify order creation failed:", error);
      return null;
    }

    const result = await response.json();
    console.log("Shopify order created:", result.order?.id);
    return result.order;
  } catch (error) {
    console.error("Shopify order creation error:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { paymentId, orderId } = await req.json();

    if (!paymentId) {
      throw new Error("paymentId is required");
    }

    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
    }

    // Check payment status at Mercado Pago
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mpResponse.ok) {
      throw new Error(`Mercado Pago API error: ${mpResponse.status}`);
    }

    const mpPayment = await mpResponse.json();
    const status = mpPayment.status; // pending, approved, rejected, etc.

    console.log(`PIX payment ${paymentId} status: ${status}`);

    // If approved, mark order as paid and create Shopify order
    if (status === "approved" && orderId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Check if already processed
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("is_paid")
        .eq("id", orderId)
        .single();

      if (existingOrder && !existingOrder.is_paid) {
        // Mark as paid
        await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
          })
          .eq("id", orderId);

        console.log("Order marked as paid:", orderId);

        // Fetch full order + customer for Shopify
        const { data: fullOrder } = await supabase
          .from("orders")
          .select("*, customer:customers(*)")
          .eq("id", orderId)
          .maybeSingle();

        if (fullOrder) {
          await createShopifyOrder(fullOrder, fullOrder.customer);
        }
      }
    }

    return new Response(
      JSON.stringify({ status, paymentId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error checking payment:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
