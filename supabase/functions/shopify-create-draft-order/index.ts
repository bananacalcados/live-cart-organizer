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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN")!;
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { registrationId } = await req.json();

    if (!registrationId) {
      throw new Error("registrationId is required");
    }

    // Get registration data
    const { data: registration, error: regError } = await supabase
      .from("customer_registrations")
      .select("*")
      .eq("id", registrationId)
      .single();

    if (regError || !registration) {
      throw new Error("Registration not found");
    }

    // Get order with products
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", registration.order_id)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    const products = order.products as Array<{
      id: string;
      shopifyId: string;
      title: string;
      variant: string;
      price: number;
      quantity: number;
    }>;

    // Build line items for Shopify draft order
    const lineItems = products.map((p) => ({
      variant_id: parseInt(p.shopifyId.replace("gid://shopify/ProductVariant/", "")),
      quantity: p.quantity,
    }));

    // Build shipping address
    const shippingAddress = {
      first_name: registration.full_name.split(" ")[0],
      last_name: registration.full_name.split(" ").slice(1).join(" ") || "-",
      address1: `${registration.address}, ${registration.address_number}`,
      address2: registration.complement || "",
      city: registration.city,
      province: registration.state,
      zip: registration.cep,
      country: "BR",
      phone: registration.whatsapp,
    };

    // Create draft order via Shopify Admin API
    const draftOrderPayload = {
      draft_order: {
        line_items: lineItems,
        shipping_address: shippingAddress,
        billing_address: shippingAddress,
        email: registration.email,
        note: `CRM Order ID: ${order.id} | CPF: ${registration.cpf}`,
        tags: "live-crm",
        customer: {
          first_name: registration.full_name.split(" ")[0],
          last_name: registration.full_name.split(" ").slice(1).join(" ") || "-",
          email: registration.email,
          phone: registration.whatsapp,
        },
      },
    };

    console.log("Creating Shopify draft order:", JSON.stringify(draftOrderPayload));

    const shopifyResponse = await fetch(
      `https://${shopifyDomain}/admin/api/2025-01/draft_orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify(draftOrderPayload),
      }
    );

    const shopifyData = await shopifyResponse.json();

    if (!shopifyResponse.ok) {
      console.error("Shopify error:", JSON.stringify(shopifyData));
      throw new Error(`Shopify API error: ${JSON.stringify(shopifyData.errors || shopifyData)}`);
    }

    const draftOrder = shopifyData.draft_order;
    console.log("Draft order created:", draftOrder.id, draftOrder.name);

    // Update registration with Shopify data
    await supabase
      .from("customer_registrations")
      .update({
        shopify_draft_order_id: String(draftOrder.id),
        shopify_draft_order_name: draftOrder.name,
        status: "completed",
      })
      .eq("id", registrationId);

    // Update customer whatsapp/email if needed
    if (order.customer) {
      await supabase
        .from("customers")
        .update({ whatsapp: registration.whatsapp })
        .eq("id", order.customer.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        draftOrderId: draftOrder.id,
        draftOrderName: draftOrder.name,
        invoiceUrl: draftOrder.invoice_url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating draft order:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
