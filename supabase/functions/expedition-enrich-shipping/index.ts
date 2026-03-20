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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN") || "ftx2e2-np.myshopify.com";
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!shopifyToken) throw new Error("SHOPIFY_ACCESS_TOKEN not configured");

    const SHOPIFY_API = `https://${shopifyDomain}/admin/api/2025-07`;

    // Fetch orders missing shipping_method that have a shopify order number (not tiny-only)
    const { data: orders, error } = await supabase
      .from("expedition_beta_orders")
      .select("id, shopify_order_number, shopify_order_id")
      .is("shipping_method", null)
      .not("shopify_order_id", "like", "tiny-%")
      .limit(50);

    if (error) throw error;
    if (!orders || orders.length === 0) {
      return new Response(JSON.stringify({ success: true, enriched: 0, message: "No orders to enrich" }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${orders.length} orders to enrich with shipping info`);

    let enriched = 0;
    let errors = 0;

    for (const order of orders) {
      const orderNumber = order.shopify_order_number;
      if (!orderNumber) continue;

      try {
        // Rate limit: 2 requests/sec to be safe
        await new Promise(r => setTimeout(r, 500));

        const url = `${SHOPIFY_API}/orders.json?name=%23${orderNumber}&fields=id,name,shipping_lines&status=any`;
        const resp = await fetch(url, {
          headers: {
            "X-Shopify-Access-Token": shopifyToken,
            "Content-Type": "application/json",
          },
        });

        if (resp.status === 429) {
          console.log("Rate limited, waiting 2s...");
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        if (!resp.ok) {
          console.error(`Shopify API error for #${orderNumber}: ${resp.status}`);
          errors++;
          continue;
        }

        const data = await resp.json();
        const shopifyOrders = data.orders || [];

        if (shopifyOrders.length === 0) {
          // No match found - mark as "N/A" to avoid re-querying
          await supabase.from("expedition_beta_orders")
            .update({ shipping_method: "N/A" })
            .eq("id", order.id);
          continue;
        }

        const shopifyOrder = shopifyOrders[0];
        const shippingLines = shopifyOrder.shipping_lines || [];
        const shippingMethod = shippingLines.length > 0 ? shippingLines[0].title : "N/A";

        await supabase.from("expedition_beta_orders")
          .update({ shipping_method: shippingMethod })
          .eq("id", order.id);

        console.log(`#${orderNumber} → ${shippingMethod}`);
        enriched++;
      } catch (err: any) {
        console.error(`Error enriching #${orderNumber}: ${err.message}`);
        errors++;
      }
    }

    return new Response(JSON.stringify({ success: true, enriched, errors, total: orders.length }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Enrich error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
