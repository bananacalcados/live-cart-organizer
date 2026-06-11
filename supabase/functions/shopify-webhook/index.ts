// Shopify webhook receiver — orders/paid + orders/updated
// HMAC validation with SHOPIFY_CLIENT_SECRET (used for Shopify custom app webhooks).
// Idempotent upsert via (external_source='shopify', external_order_id).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const TINY_SHOPIFY_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";

async function verifyHmac(rawBody: string, hmacHeader: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return computed === hmacHeader;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const raw = await req.text();
    const hmac = req.headers.get("x-shopify-hmac-sha256") || "";
    const topic = req.headers.get("x-shopify-topic") || "";
    const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") || Deno.env.get("SHOPIFY_CLIENT_SECRET") || "";

    if (secret && hmac) {
      const ok = await verifyHmac(raw, hmac, secret);
      if (!ok) {
        console.warn("Invalid HMAC for topic", topic);
        return new Response("Invalid HMAC", { status: 401, headers: corsHeaders });
      }
    }

    const o = JSON.parse(raw);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const financial = (o.financial_status || "").toLowerCase();
    const topicLc = topic.toLowerCase();

    // --- Cancellation / refund handling ---
    // Triggered by orders/cancelled, refunds/create, or orders/updated with
    // cancelled_at set or financial_status refunded/voided. Marks the matching
    // pos_sales row as cancelled so it leaves revenue immediately (event-driven).
    const refundOrderId = o.order_id ? String(o.order_id) : null; // refunds/create payload
    const isCancelEvent =
      topicLc.includes("cancel") ||
      topicLc.includes("refund") ||
      !!o.cancelled_at ||
      ["refunded", "voided", "partially_refunded"].includes(financial);

    if (isCancelEvent) {
      const targetId = refundOrderId || String(o.id);
      const { data: row } = await supabase
        .from("pos_sales")
        .select("id, status, notes")
        .eq("external_source", "shopify")
        .eq("external_order_id", targetId)
        .maybeSingle();
      if (!row) {
        return new Response(JSON.stringify({ ok: true, cancel_skipped: "sale not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.status === "cancelled") {
        return new Response(JSON.stringify({ ok: true, already_cancelled: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const reason = topicLc.includes("refund") || financial.includes("refund") ? "estorno" : "cancelamento";
      await supabase
        .from("pos_sales")
        .update({
          status: "cancelled",
          notes: `${row.notes || ""} | Shopify ${reason} (${topic || financial})`.trim(),
        })
        .eq("id", row.id);
      return new Response(JSON.stringify({ ok: true, cancelled: true, sale_id: row.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only paid orders count as revenue
    if (!["paid", "partially_paid"].includes(financial)) {
      return new Response(JSON.stringify({ ok: true, skipped: "not paid" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const externalId = String(o.id);
    const { data: existing } = await supabase
      .from("pos_sales")
      .select("id")
      .eq("external_source", "shopify")
      .eq("external_order_id", externalId)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const total = Number(o.total_price || 0);
    const subtotal = Number(o.subtotal_price || total);
    const discount = Number(o.total_discounts || 0);
    const shippingCost = Number(o.total_shipping_price_set?.shop_money?.amount || 0);
    const items = (o.line_items || []) as any[];
    const customerName = o.customer ? `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim() : null;
    const customerPhone = o.phone || o.customer?.phone || null;
    const gateway = (o.payment_gateway_names || [])[0] || o.gateway || "shopify";

    const { data: sale, error } = await supabase
      .from("pos_sales")
      .insert({
        store_id: TINY_SHOPIFY_STORE_ID,
        external_source: "shopify",
        external_order_id: externalId,
        sale_type: "online",
        status: "completed",
        payment_method: gateway,
        payment_gateway: "shopify",
        subtotal, discount, total,
        shipping_cost: shippingCost,
        customer_name: customerName,
        customer_phone: customerPhone,
        paid_at: o.created_at,
        created_at: o.created_at,
        notes: `Shopify ${o.name || ""}`.trim(),
      } as any)
      .select("id")
      .single();
    if (error) throw error;

    if (items.length > 0) {
      // Enriquece cada item com barcode (gtin) e sku reais via product_variants,
      // casando pelo variant_id da Shopify. Isso garante que o trigger de baixa
      // de estoque (apply_pos_sale_stock_movement) encontre o produto certo e
      // abata do estoque compartilhado (loja que tiver saldo da variação).
      const variantIds = Array.from(
        new Set(items.map((li: any) => (li.variant_id != null ? String(li.variant_id) : "")).filter(Boolean)),
      );
      const variantInfo = new Map<string, { gtin: string | null; sku: string | null }>();
      if (variantIds.length) {
        const { data: pv } = await supabase
          .from("product_variants")
          .select("shopify_variant_id, gtin, sku")
          .in("shopify_variant_id", variantIds);
        for (const v of pv || []) {
          if (v.shopify_variant_id) {
            variantInfo.set(String(v.shopify_variant_id), { gtin: v.gtin ?? null, sku: v.sku ?? null });
          }
        }
      }

      const rows = items.map((li: any) => {
        const info = li.variant_id != null ? variantInfo.get(String(li.variant_id)) : undefined;
        return {
          sale_id: sale.id,
          product_name: li.title || li.name || "Item Shopify",
          variant_name: li.variant_title || null,
          sku: info?.sku || li.sku || null,
          barcode: info?.gtin || li.barcode || null,
          unit_price: Number(li.price || 0),
          quantity: Number(li.quantity || 1),
          total_price: Number(li.price || 0) * Number(li.quantity || 1),
        };
      });
      await supabase.from("pos_sale_items").insert(rows);
    }

    return new Response(JSON.stringify({ ok: true, inserted: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("shopify-webhook error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
