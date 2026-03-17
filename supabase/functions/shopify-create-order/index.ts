import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ShopifyCustomerSearchResult = {
  customers?: Array<{ id?: number | string | null }>;
};

function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const full = digits.startsWith("55") ? digits : `55${digits}`;
  if (full.length < 12 || full.length > 13) return null;
  return `+${full}`;
}

async function createShopifyOrderRequest(
  shopifyDomain: string,
  shopifyToken: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/orders.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shopifyToken,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  const responseJson = responseText ? JSON.parse(responseText) : null;

  return {
    ok: response.ok,
    status: response.status,
    bodyText: responseText,
    bodyJson: responseJson,
  };
}

async function findExistingCustomerIdByField(
  shopifyDomain: string,
  shopifyToken: string,
  field: "phone" | "email",
  value: string | null,
): Promise<number | null> {
  if (!value) return null;

  const query = `${field}:${value}`;
  const response = await fetch(
    `https://${shopifyDomain}/admin/api/2025-01/customers/search.json?query=${encodeURIComponent(query)}`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken,
      },
    },
  );

  if (!response.ok) {
    console.warn(`Customer search failed for ${field}:`, await response.text());
    return null;
  }

  const result = await response.json() as ShopifyCustomerSearchResult;
  const customerId = result.customers?.[0]?.id;
  return customerId ? Number(customerId) : null;
}

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) throw new Error("Order not found");

    const { data: registration } = await supabase
      .from("customer_registrations")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

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
      discountAmount = order.discount_type === "percentage"
        ? subtotal * (order.discount_value / 100)
        : order.discount_value;
    }

    const customer = order.customer;
    const phone = formatPhone(registration?.whatsapp || customer?.whatsapp);
    const email = registration?.email?.trim() || null;

    const fullName = (registration?.full_name || customer?.instagram_handle || "Cliente").trim();
    const nameParts = fullName.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ").trim() || "-";

    const shopifyCustomer: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
    };
    if (email) shopifyCustomer.email = email;
    if (phone) shopifyCustomer.phone = phone;

    let shippingAddress: Record<string, unknown> | null = null;
    if (registration) {
      shippingAddress = {
        first_name: firstName,
        last_name: lastName,
        address1: registration.address ? `${registration.address}, ${registration.address_number}` : undefined,
        address2: registration.complement || undefined,
        city: registration.city || undefined,
        province: registration.state || undefined,
        zip: registration.cep || undefined,
        country: "BR",
        phone: phone || undefined,
      };
    }

    const noteAttributes: Array<{ name: string; value: string }> = [];
    if (registration?.cpf) {
      noteAttributes.push({ name: "cpf", value: registration.cpf });
    }

    const buildShopifyOrderPayload = (customerPayload: Record<string, unknown>) => ({
      order: {
        line_items: lineItems,
        financial_status: "paid",
        note: `Pedido criado manualmente via CRM - Order #${orderId.substring(0, 8)}${registration?.cpf ? ` | CPF: ${registration.cpf}` : ""}`,
        tags: "crm,manual-sync",
        customer: customerPayload,
        ...(noteAttributes.length > 0 ? { note_attributes: noteAttributes } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(shippingAddress ? { shipping_address: shippingAddress, billing_address: shippingAddress } : {}),
        ...(discountAmount > 0
          ? { discount_codes: [{ code: "CRM-DISCOUNT", amount: discountAmount.toFixed(2), type: "fixed_amount" }] }
          : {}),
      },
    });

    console.log("Creating Shopify order for:", orderId, "with customer:", JSON.stringify(shopifyCustomer));

    let result = await createShopifyOrderRequest(
      shopifyDomain,
      shopifyToken,
      buildShopifyOrderPayload(shopifyCustomer),
    );

    if (!result.ok && result.status === 422 && result.bodyText.includes("customer.phone_number")) {
      console.warn("Phone already belongs to an existing Shopify customer, retrying with existing customer id");

      const existingCustomerId =
        await findExistingCustomerIdByField(shopifyDomain, shopifyToken, "phone", phone) ||
        await findExistingCustomerIdByField(shopifyDomain, shopifyToken, "email", email);

      const fallbackCustomerPayload = existingCustomerId
        ? { id: existingCustomerId }
        : Object.fromEntries(Object.entries(shopifyCustomer).filter(([key]) => key !== "phone"));

      result = await createShopifyOrderRequest(
        shopifyDomain,
        shopifyToken,
        buildShopifyOrderPayload(fallbackCustomerPayload),
      );
    }

    if (!result.ok) {
      console.error("Shopify error:", result.bodyText);
      throw new Error(`Shopify API error ${result.status}: ${result.bodyText}`);
    }

    console.log("Shopify order created:", result.bodyJson?.order?.id, result.bodyJson?.order?.name);

    return new Response(
      JSON.stringify({
        success: true,
        shopifyOrderId: result.bodyJson?.order?.id,
        shopifyOrderName: result.bodyJson?.order?.name,
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
