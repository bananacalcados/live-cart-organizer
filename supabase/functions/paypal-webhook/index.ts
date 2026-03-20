import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function getPayPalAccessToken(): Promise<string> {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID")!;
  const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET")!;
  const baseUrl = Deno.env.get("PAYPAL_BASE_URL") || "https://api-m.paypal.com";

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(`PayPal auth failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function capturePayPalOrder(paypalOrderId: string, accessToken: string) {
  const baseUrl = Deno.env.get("PAYPAL_BASE_URL") || "https://api-m.paypal.com";
  
  const response = await fetch(`${baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal capture failed: ${error}`);
  }

  return await response.json();
}

async function createShopifyOrder(order: Record<string, unknown>, customer: Record<string, unknown>, supabase: ReturnType<typeof createClient>) {
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

  // Build line items for Shopify
  const lineItems = products.map((p) => {
    // Try to extract variant ID
    const variantIdMatch = p.shopifyId?.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
    if (variantIdMatch) {
      return {
        variant_id: parseInt(variantIdMatch[1]),
        quantity: p.quantity,
        price: p.price.toFixed(2),
      };
    }
    // Fallback: use title
    return {
      title: p.title,
      quantity: p.quantity,
      price: p.price.toFixed(2),
    };
  });

  // Calculate discount
  let discountAmount = 0;
  const subtotal = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  if (order.discount_type && order.discount_value) {
    const dv = order.discount_value as number;
    discountAmount = order.discount_type === "percentage"
      ? subtotal * (dv / 100)
      : dv;
  }

  const shopifyOrder: Record<string, unknown> = {
    order: {
      line_items: lineItems,
      financial_status: "paid",
      note: `Pedido pago via PayPal - CRM Order #${(order.id as string).substring(0, 8)}`,
      tags: "paypal,crm",
      ...(discountAmount > 0
        ? {
            discount_codes: [
              {
                code: "CRM-DISCOUNT",
                amount: discountAmount.toFixed(2),
                type: "fixed_amount",
              },
            ],
          }
        : {}),
    },
  };

  // Add customer info safely - format phone for Shopify (+55XXXXXXXXXXX)
  if (customer) {
    const orderObj = shopifyOrder.order as Record<string, unknown>;
    orderObj.customer = {
      first_name: (customer.instagram_handle as string) || "Cliente",
    };
    
    const rawPhone = (customer.whatsapp as string) || "";
    if (rawPhone) {
      // Clean and format phone: ensure it starts with +55
      const digits = rawPhone.replace(/\D/g, "");
      if (digits.length >= 10) {
        const formatted = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
        orderObj.phone = formatted;
      }
    }
  }

  try {
    const response = await fetch(
      `https://${shopifyDomain}/admin/api/2024-01/orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify(shopifyOrder),
      }
    );

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
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // Handle capture action (called from checkout page)
    if (action === "capture" || req.method === "POST") {
      const body = await req.json();
      const paypalOrderId = body.paypalOrderId || url.searchParams.get("token");

      if (!paypalOrderId) {
        throw new Error("PayPal order ID is required");
      }

      console.log("Capturing PayPal order:", paypalOrderId);

      // Get access token and capture
      const accessToken = await getPayPalAccessToken();
      const captureResult = await capturePayPalOrder(paypalOrderId, accessToken);

      console.log("Capture result:", JSON.stringify(captureResult, null, 2));

      const captureId = captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      const payerName = captureResult.payer?.name
        ? `${captureResult.payer.name.given_name} ${captureResult.payer.name.surname}`
        : null;
      const payerEmail = captureResult.payer?.email_address;
      const referenceId = captureResult.purchase_units?.[0]?.reference_id;

      // Update paypal_payments record
      const { error: updatePaymentError } = await supabase
        .from("paypal_payments")
        .update({
          status: "captured",
          capture_id: captureId,
          payer_name: payerName,
          payer_email: payerEmail,
        })
        .eq("paypal_order_id", paypalOrderId);

      if (updatePaymentError) {
        console.error("Error updating payment:", updatePaymentError);
      }

      // Find the CRM order
      const { data: payment } = await supabase
        .from("paypal_payments")
        .select("order_id")
        .eq("paypal_order_id", paypalOrderId)
        .maybeSingle();

      if (payment?.order_id) {
        // Update CRM order to paid
        const { error: orderUpdateError } = await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
          })
          .eq("id", payment.order_id);

        if (orderUpdateError) {
          console.error("Error updating order:", orderUpdateError);
        }

        // Fetch full order + customer for Shopify
        const { data: fullOrder } = await supabase
          .from("orders")
          .select("*, customer:customers(*)")
          .eq("id", payment.order_id)
          .maybeSingle();

        if (fullOrder) {
          // Create Shopify order
          await createShopifyOrder(fullOrder, fullOrder.customer, supabase);
        }

        console.log("Order marked as paid:", payment.order_id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          captureId,
          payerName,
          payerEmail,
          status: captureResult.status,
        }),
        {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      }
    );
  }
});
