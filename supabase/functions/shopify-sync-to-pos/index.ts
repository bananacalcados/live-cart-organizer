// Shopify → POS backfill / cron sync
// Imports Shopify orders as pos_sales rows for the "Tiny Shopify" store.
// Idempotent via pos_sales.external_source='shopify' + external_order_id=<order.id>.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TINY_SHOPIFY_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const days = Number(body.days || 30);
    const limit = Number(body.limit || 250);

    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return new Response(JSON.stringify({ error: "Shopify env missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - days * 86400000).toISOString();
    let url: string | null = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders.json?status=any&financial_status=paid&created_at_min=${since}&limit=${limit}&fields=id,name,total_price,subtotal_price,total_discounts,total_shipping_price_set,line_items,created_at,financial_status,customer,phone,email,gateway,payment_gateway_names,shipping_address,billing_address,note_attributes`;

    let inserted = 0, skipped = 0, errors = 0, pages = 0;
    const safetyMax = 20;

    while (url && pages < safetyMax) {
      pages++;
      const r = await fetch(url, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const txt = await r.text();
        return new Response(JSON.stringify({ error: `Shopify ${r.status}`, body: txt.slice(0, 500) }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await r.json();
      const orders = data.orders || [];

      for (const o of orders) {
        const externalId = String(o.id);
        try {
          const { data: existing } = await supabase
            .from("pos_sales")
            .select("id")
            .eq("external_source", "shopify")
            .eq("external_order_id", externalId)
            .maybeSingle();
          if (existing) { skipped++; continue; }

          const total = Number(o.total_price || 0);
          const subtotal = Number(o.subtotal_price || total);
          const discount = Number(o.total_discounts || 0);
          const shippingCost = Number(o.total_shipping_price_set?.shop_money?.amount || 0);
          const items = (o.line_items || []) as any[];
          const customerName = o.customer ? `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim() : null;
          const customerPhone = o.phone || o.customer?.phone || null;
          const gateway = (o.payment_gateway_names || [])[0] || o.gateway || "shopify";

          const { data: sale, error: saleErr } = await supabase
            .from("pos_sales")
            .insert({
              store_id: TINY_SHOPIFY_STORE_ID,
              external_source: "shopify",
              external_order_id: externalId,
              sale_type: "online",
              status: "completed",
              payment_method: gateway,
              payment_gateway: "shopify",
              subtotal,
              discount,
              total,
              shipping_cost: shippingCost,
              customer_name: customerName,
              customer_phone: customerPhone,
              paid_at: o.created_at,
              created_at: o.created_at,
              notes: `Shopify ${o.name || ""}`.trim(),
            } as any)
            .select("id")
            .single();
          if (saleErr) throw saleErr;

          if (items.length > 0) {
            const itemRows = items.map((li: any) => ({
              sale_id: sale.id,
              product_name: li.title || li.name || "Item Shopify",
              variant_name: li.variant_title || null,
              sku: li.sku || null,
              unit_price: Number(li.price || 0),
              quantity: Number(li.quantity || 1),
              total_price: Number(li.price || 0) * Number(li.quantity || 1),
            }));
            await supabase.from("pos_sale_items").insert(itemRows);
          }
          inserted++;
        } catch (e: any) {
          console.error("Order error", o.id, e.message);
          errors++;
        }
      }

      const link = r.headers.get("link") || r.headers.get("Link");
      const next = link?.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }

    return new Response(JSON.stringify({ ok: true, inserted, skipped, errors, pages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
