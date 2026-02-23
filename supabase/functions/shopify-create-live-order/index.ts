import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
      throw new Error("Shopify credentials not configured");
    }

    const { items, customer } = await req.json();
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("items array is required");
    }

    // Build line items from cart data
    const lineItems = items.map((item: any) => {
      // Try to extract numeric variant ID from gid://shopify/ProductVariant/XXXXX
      const variantIdMatch = item.variantId?.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
      if (variantIdMatch) {
        return {
          variant_id: parseInt(variantIdMatch[1]),
          quantity: item.quantity || 1,
          price: (item.price || 0).toFixed(2),
        };
      }
      // Fallback: use title-based line item
      return {
        title: item.title || item.productTitle || "Produto",
        quantity: item.quantity || 1,
        price: (item.price || 0).toFixed(2),
      };
    });

    // Format phone
    function formatPhone(raw: string | null | undefined): string | null {
      if (!raw) return null;
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 10) return null;
      const full = digits.startsWith("55") ? digits : `55${digits}`;
      if (full.length < 12 || full.length > 13) return null;
      return `+${full}`;
    }

    const phone = formatPhone(customer?.phone);
    const fullName = (customer?.name || "Cliente Live").trim();
    const nameParts = fullName.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ").trim() || "-";

    const shopifyCustomer: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
    };
    if (customer?.email) shopifyCustomer.email = customer.email;
    if (phone) shopifyCustomer.phone = phone;

    // Build shipping/billing address if available from checkout form
    let shippingAddress: Record<string, unknown> | null = null;
    const addr = customer?.address;
    if (addr && (addr.street || addr.city)) {
      shippingAddress = {
        first_name: firstName,
        last_name: lastName,
        address1: addr.street ? `${addr.street}, ${addr.number || ""}`.trim() : undefined,
        city: addr.city || undefined,
        province: addr.state || undefined,
        zip: addr.cep || undefined,
        country: "BR",
        phone: phone || undefined,
      };
    }

    // Build note_attributes with CPF so Tiny ERP can import it
    const noteAttributes: Array<{ name: string; value: string }> = [];
    if (customer?.cpf) {
      noteAttributes.push({ name: "cpf", value: customer.cpf });
    }

    const shopifyOrder = {
      order: {
        line_items: lineItems,
        financial_status: "paid",
        note: `Pedido via Live Commerce${customer?.cpf ? ` | CPF: ${customer.cpf}` : ""} | Cliente: ${fullName} | Tel: ${customer?.phone || "N/A"}`,
        tags: "live-commerce,auto-sync",
        customer: shopifyCustomer,
        ...(noteAttributes.length > 0 ? { note_attributes: noteAttributes } : {}),
        ...(customer?.email ? { email: customer.email } : {}),
        ...(phone ? { phone } : {}),
        ...(shippingAddress ? { shipping_address: shippingAddress, billing_address: shippingAddress } : {}),
      },
    };

    console.log("Creating Shopify order from live:", JSON.stringify({ customer: shopifyCustomer, itemCount: lineItems.length }));

    const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/orders.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken,
      },
      body: JSON.stringify(shopifyOrder),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Shopify error:", errorBody);
      throw new Error(`Shopify API error ${response.status}: ${errorBody}`);
    }

    const result = await response.json();
    console.log("Shopify live order created:", result.order?.id, result.order?.name);

    return new Response(
      JSON.stringify({
        success: true,
        shopifyOrderId: result.order?.id,
        shopifyOrderName: result.order?.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error creating Shopify live order:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
