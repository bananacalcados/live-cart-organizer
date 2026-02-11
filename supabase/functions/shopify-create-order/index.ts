import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    if (!shopifyDomain || !shopifyToken) {
      throw new Error("Shopify credentials not configured (SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN)");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    // Fetch order + customer
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) throw new Error("Order not found");

    const products = order.products as Array<{
      shopifyId: string;
      title: string;
      variant: string;
      price: number;
      quantity: number;
      sku?: string;
    }>;

    // Build line items
    const lineItems = products.map((p) => {
      const variantIdMatch = p.shopifyId?.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
      if (variantIdMatch) {
        return { variant_id: parseInt(variantIdMatch[1]), quantity: p.quantity, price: p.price.toFixed(2) };
      }
      return { title: p.title, quantity: p.quantity, price: p.price.toFixed(2) };
    });

    // Calculate discount
    let discountAmount = 0;
    const subtotal = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
    if (order.discount_type && order.discount_value) {
      discountAmount = order.discount_type === "percentage"
        ? subtotal * (order.discount_value / 100)
        : order.discount_value;
    }

    // Build customer info
    const customer = order.customer;
    const customerObj: Record<string, unknown> = {};
    if (customer) {
      customerObj.customer = { first_name: customer.instagram_handle || "Cliente" };
      const rawPhone = customer.whatsapp || "";
      if (rawPhone) {
        const digits = rawPhone.replace(/\D/g, "");
        if (digits.length >= 10) {
          customerObj.phone = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
        }
      }
    }

    const shopifyOrder: Record<string, unknown> = {
      order: {
        line_items: lineItems,
        financial_status: "paid",
        note: `Pedido criado manualmente via CRM - Order #${orderId.substring(0, 8)}`,
        tags: "crm,manual-sync",
        ...customerObj,
        ...(discountAmount > 0
          ? { discount_codes: [{ code: "CRM-DISCOUNT", amount: discountAmount.toFixed(2), type: "fixed_amount" }] }
          : {}),
      },
    };

    console.log("Creating Shopify order for:", orderId);

    const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/orders.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
      body: JSON.stringify(shopifyOrder),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Shopify error:", errorBody);
      throw new Error(`Shopify API error ${response.status}: ${errorBody}`);
    }

    const result = await response.json();
    console.log("Shopify order created:", result.order?.id, result.order?.name);

    return new Response(
      JSON.stringify({
        success: true,
        shopifyOrderId: result.order?.id,
        shopifyOrderName: result.order?.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error creating Shopify order:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
