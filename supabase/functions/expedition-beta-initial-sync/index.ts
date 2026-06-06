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

const API_VERSION = "2024-01";

// Map Shopify financial_status -> expedition financial_status
function mapFinancial(order: any): string {
  if (order.cancelled_at) return "cancelled";
  const fs = order.financial_status || "";
  if (["paid", "partially_paid", "authorized"].includes(fs)) return "paid";
  if (["refunded", "voided"].includes(fs)) return "cancelled";
  return "pending";
}

// Derive expedition_status from Shopify order state
function mapExpeditionStatus(order: any): string {
  if (order.cancelled_at) return "cancelled";
  const ff = order.fulfillment_status; // 'fulfilled' | 'partial' | null
  const paid = ["paid", "partially_paid", "authorized"].includes(order.financial_status || "");
  if (ff === "fulfilled") return "dispatched";
  if (paid) return "approved";
  return "pending";
}

function extractTracking(order: any): string | null {
  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  for (const f of fulfillments) {
    if (f.tracking_number) return f.tracking_number;
    if (Array.isArray(f.tracking_numbers) && f.tracking_numbers.length) return f.tracking_numbers[0];
  }
  return null;
}

function extractShippingMethod(order: any): string | null {
  const lines = Array.isArray(order.shipping_lines) ? order.shipping_lines : [];
  return lines[0]?.title || null;
}

function extractCpf(order: any): string | null {
  const attrs = Array.isArray(order.note_attributes) ? order.note_attributes : [];
  for (const a of attrs) {
    const name = (a.name || "").toLowerCase();
    if (name.includes("cpf") || name.includes("cnpj") || name.includes("document")) {
      const v = (a.value || "").replace(/\D/g, "");
      if (v.length >= 11) return v;
    }
  }
  // Brazilian apps sometimes store CPF in shipping_address.company
  const company = order.shipping_address?.company || order.billing_address?.company || "";
  const digits = company.replace(/\D/g, "");
  if (digits.length === 11) return digits;
  return null;
}

function mapShippingAddress(order: any): any {
  const a = order.shipping_address || order.billing_address;
  if (!a) return null;
  return {
    address1: a.address1 || "",
    address2: a.address2 || "",
    city: a.city || "",
    province: a.province || "",
    province_code: a.province_code || "",
    zip: a.zip || "",
    country: a.country || "Brazil",
    name: a.name || `${a.first_name || ""} ${a.last_name || ""}`.trim(),
    number: a.address2 || "",
    neighborhood: a.address2 || "",
    phone: a.phone || order.phone || "",
  };
}

async function shopifyGet(url: string, token: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    });
    if (resp.status === 429) {
      const wait = Math.min(2000 * Math.pow(2, attempt), 8000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return resp;
  }
  throw new Error("Shopify rate limit exceeded");
}

function nextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const p of parts) {
    if (p.includes('rel="next"')) {
      const m = p.match(/page_info=([^>&]+)/);
      if (m) return m[1];
    }
  }
  return null;
}

async function loadExisting(supabase: any): Promise<Map<string, { id: string; expedition_status: string; tracking_code: string | null; has_items: boolean }>> {
  const map = new Map();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabase
      .from("expedition_beta_orders")
      .select("id, shopify_order_id, expedition_status, tracking_code")
      .not("shopify_order_id", "is", null)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const row of data) {
      map.set(String(row.shopify_order_id), {
        id: row.id,
        expedition_status: row.expedition_status,
        tracking_code: row.tracking_code,
        has_items: false,
      });
    }
    from += PAGE;
    if (data.length < PAGE) break;
  }
  return map;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      throw new Error("Credenciais da Shopify não configuradas (SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN).");
    }

    const startTime = Date.now();
    const timeoutMs = 110000;

    // Optional body: { days } window for created_at_min (default 120)
    let days = 120;
    try {
      const body = await req.json();
      if (body?.days && Number(body.days) > 0) days = Number(body.days);
    } catch (_) { /* no body */ }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const createdMin = sinceDate.toISOString();

    const existingMap = await loadExisting(supabase);
    console.log(`Loaded ${existingMap.size} existing Shopify-sourced orders`);

    let synced = 0, updated = 0, skipped = 0;
    const fields = [
      "id", "name", "order_number", "created_at", "cancelled_at",
      "financial_status", "fulfillment_status", "total_price", "subtotal_price",
      "total_discounts", "total_shipping_price_set", "total_weight", "line_items",
      "customer", "phone", "email", "shipping_address", "billing_address",
      "note", "note_attributes", "fulfillments", "shipping_lines", "tags",
    ].join(",");

    let pageInfo: string | null = null;
    let pageCount = 0;

    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        console.log("Global timeout reached, stopping pagination");
        break;
      }
      pageCount++;
      if (pageCount > 25) break;

      const url = pageInfo
        ? `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=100&status=any&page_info=${pageInfo}&fields=${fields}`
        : `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=100&status=any&created_at_min=${createdMin}&fields=${fields}`;

      const resp = await shopifyGet(url, SHOPIFY_TOKEN);
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Shopify orders failed (${resp.status}): ${t.substring(0, 300)}`);
      }
      const json = await resp.json();
      const orders = json.orders || [];
      if (orders.length === 0) break;

      for (const order of orders) {
        if (Date.now() - startTime > timeoutMs) break;
        const sid = String(order.id);
        const expeditionStatus = mapExpeditionStatus(order);
        const financialStatus = mapFinancial(order);
        const tracking = extractTracking(order);
        const existing = existingMap.get(sid);

        if (existing) {
          const updateData: any = {};
          if (existing.expedition_status !== expeditionStatus && existing.expedition_status !== "cancelled") {
            updateData.expedition_status = expeditionStatus;
          }
          if (tracking && existing.tracking_code !== tracking) {
            updateData.tracking_code = tracking;
          }
          if (Object.keys(updateData).length > 0) {
            updateData.fulfillment_status = order.fulfillment_status || "unfulfilled";
            updateData.financial_status = financialStatus;
            updateData.updated_at = new Date().toISOString();
            await supabase.from("expedition_beta_orders").update(updateData).eq("id", existing.id);
            updated++;
          } else {
            skipped++;
          }
          continue;
        }

        const customer = order.customer || {};
        const shipName = order.shipping_address?.name || `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
        const customerName = shipName || "Cliente Shopify";
        const phone = order.phone || order.shipping_address?.phone || customer.phone || null;

        const { data: inserted, error: insertError } = await supabase
          .from("expedition_beta_orders")
          .insert({
            shopify_order_id: sid,
            shopify_order_name: order.name || `#${order.order_number}`,
            shopify_order_number: String(order.order_number || ""),
            shopify_created_at: order.created_at || new Date().toISOString(),
            customer_name: customerName,
            customer_email: order.email || customer.email || null,
            customer_phone: phone,
            customer_cpf: extractCpf(order),
            shipping_address: mapShippingAddress(order),
            financial_status: financialStatus,
            fulfillment_status: order.fulfillment_status || "unfulfilled",
            expedition_status: expeditionStatus,
            subtotal_price: parseFloat(order.subtotal_price || "0"),
            total_price: parseFloat(order.total_price || "0"),
            total_discount: parseFloat(order.total_discounts || "0"),
            total_shipping: parseFloat(order.total_shipping_price_set?.shop_money?.amount || "0"),
            total_weight_grams: parseInt(order.total_weight || "0", 10) || 0,
            has_gift: (order.note || "").toLowerCase().includes("brinde"),
            is_from_live: (order.tags || "").toLowerCase().includes("live"),
            notes: order.note || null,
            shipping_method: extractShippingMethod(order),
            tracking_code: tracking,
          })
          .select()
          .single();

        if (insertError) {
          console.error(`Insert error ${sid}:`, insertError.message);
          continue;
        }

        const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
        if (lineItems.length > 0 && inserted) {
          const itemsToInsert = lineItems.map((li: any) => ({
            expedition_order_id: inserted.id,
            product_name: li.title || li.name || "Produto",
            variant_name: li.variant_title || null,
            sku: li.sku || null,
            quantity: parseInt(li.quantity || "1", 10),
            unit_price: parseFloat(li.price || "0"),
            weight_grams: parseInt(li.grams || "0", 10) || 0,
          }));
          await supabase.from("expedition_beta_order_items").insert(itemsToInsert);
        }

        existingMap.set(sid, {
          id: inserted.id,
          expedition_status: expeditionStatus,
          tracking_code: tracking,
          has_items: lineItems.length > 0,
        });
        synced++;
      }

      pageInfo = nextPageInfo(resp.headers.get("link") || resp.headers.get("Link"));
      if (!pageInfo) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Shopify sync done in ${elapsed}s: ${synced} synced, ${updated} updated, ${skipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      source: "shopify",
      synced,
      updated,
      skipped,
      elapsed,
    }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Shopify sync error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
