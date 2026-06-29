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
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;
const SHOPIFY_STORE_DOMAIN =
  Deno.env.get("SHOPIFY_STORE_DOMAIN") || "banana-calcados.myshopify.com";

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SIZE_NAMES = ["tamanho", "numeracao", "numero", "size", "tam"];
const COLOR_NAMES = ["cor", "color", "colour"];

// Extract a numeric shoe-size token (e.g. "34", "37.5")
const sizeToken = (v: string): string | null => {
  const m = (v || "").match(/\b(\d{2}(?:[.,]\d)?)\b/);
  return m ? m[1].replace(",", ".") : null;
};

const productGidToNumeric = (gid: string): string =>
  (gid || "").replace("gid://shopify/Product/", "").split("-")[0];

const productGidFromOrderItem = (id: string): string => {
  // order item id format: "gid://shopify/Product/X-gid://shopify/ProductVariant/Y"
  const idx = id.indexOf("-gid://shopify/ProductVariant/");
  return idx >= 0 ? id.slice(0, idx) : id;
};

async function fetchShopifyProduct(numericId: string) {
  const res = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${numericId}.json`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      },
    },
  );
  if (!res.ok) {
    console.error("Shopify product fetch error", numericId, res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data?.product || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const cors = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const action: string = body?.action;
    const orderId: string = body?.order_id;
    if (!action || !orderId) return json({ error: "action and order_id required" }, 400);

    // Load order (products + event)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, event_id, products")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) return json({ error: "order not found" }, 404);

    const products: any[] = Array.isArray(order.products) ? order.products : [];

    // ---------------- LIST ----------------
    if (action === "list") {
      // Event must allow crossell
      const { data: ev } = await supabase
        .from("events")
        .select("crossell_enabled")
        .eq("id", order.event_id)
        .maybeSingle();
      if (!ev?.crossell_enabled) return json({ offers: [], cart: [] });

      // Original (non-crossell) items only define eligibility
      const originalItems = products.filter((p) => !p?.is_crossell);
      if (originalItems.length === 0) return json({ offers: [], cart: [] });

      // Customer sizes + products already owned
      const customerSizes = new Set<string>();
      const ownedProductGids = new Set<string>();
      for (const it of originalItems) {
        ownedProductGids.add(productGidFromOrderItem(String(it.id || "")));
        const t = sizeToken(String(it.variant || ""));
        if (t) customerSizes.add(t);
      }

      const { data: offers } = await supabase
        .from("event_crossell_offers")
        .select("*")
        .eq("event_id", order.event_id)
        .eq("is_active", true)
        .order("position", { ascending: true });

      // current crossell items in this order
      const { data: cartItems } = await supabase
        .from("order_crossell_items")
        .select("*")
        .eq("order_id", orderId);

      const blocks: any[] = [];

      for (const offer of offers || []) {
        // Never offer a product the customer already has
        if (ownedProductGids.has(offer.shopify_product_id)) continue;

        const prod = await fetchShopifyProduct(
          productGidToNumeric(offer.shopify_product_id),
        );
        if (!prod) continue;

        const options: any[] = prod.options || [];
        const sizePos = options.find((o) => SIZE_NAMES.includes(norm(o.name)))?.position;
        const colorPos = options.find((o) => COLOR_NAMES.includes(norm(o.name)))?.position;
        const imageById: Record<string, string> = {};
        for (const img of prod.images || []) imageById[String(img.id)] = img.src;
        const firstImage = prod.images?.[0]?.src || offer.image || null;

        const optVal = (variant: any, pos?: number) =>
          pos ? variant[`option${pos}`] : null;

        // Group available variants by color
        const byColor: Record<
          string,
          { color: string; size: string | null; variantId: string; image: string }
        > = {};

        for (const v of prod.variants || []) {
          const inv = typeof v.inventory_quantity === "number" ? v.inventory_quantity : 0;
          if (inv <= 0) continue;

          const color = (colorPos ? optVal(v, colorPos) : "") || "Único";
          const vSize = sizePos ? sizeToken(String(optVal(v, sizePos) || "")) : null;

          if (offer.has_sizes) {
            // footwear: must match a customer size
            if (!vSize || !customerSizes.has(vSize)) continue;
          }

          const colorKey = norm(color) || "unico";
          if (byColor[colorKey]) continue; // one block per color
          const image = (v.image_id && imageById[String(v.image_id)]) || firstImage;
          byColor[colorKey] = {
            color,
            size: offer.has_sizes ? vSize : null,
            variantId: `gid://shopify/ProductVariant/${v.id}`,
            image,
          };
        }

        for (const b of Object.values(byColor)) {
          blocks.push({
            offer_id: offer.id,
            shopify_product_id: offer.shopify_product_id,
            variant_id: b.variantId,
            title: offer.product_title || prod.title,
            color: b.color,
            size: b.size,
            image: b.image,
            original_price: Number(offer.original_price),
            discount_price: Number(offer.discount_price),
          });
        }
      }

      return json({ offers: blocks, cart: cartItems || [] });
    }

    // ---------------- ADD ----------------
    if (action === "add") {
      const { offer_id, variant_id, color, size, image, title } = body;
      if (!offer_id || !variant_id) return json({ error: "offer_id and variant_id required" }, 400);

      const { data: offer } = await supabase
        .from("event_crossell_offers")
        .select("*")
        .eq("id", offer_id)
        .eq("event_id", order.event_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!offer) return json({ error: "offer not available" }, 400);

      const discount = Number(offer.discount_price);
      const original = Number(offer.original_price);

      // Insert tracking row (ignore duplicate)
      const { error: insErr } = await supabase.from("order_crossell_items").insert({
        order_id: orderId,
        event_id: order.event_id,
        offer_id,
        shopify_product_id: offer.shopify_product_id,
        shopify_variant_id: variant_id,
        title: title || offer.product_title,
        color: color || null,
        size: size || null,
        image: image || offer.image || null,
        original_price: original,
        discount_price: discount,
        qty: 1,
      });
      if (insErr && !String(insErr.message).includes("duplicate")) {
        return json({ error: insErr.message }, 400);
      }

      // Append to order products (discount isolated on the crossell item)
      const itemId = `${offer.shopify_product_id}-${variant_id}`;
      const exists = products.some((p) => p.is_crossell && p.shopifyId === variant_id);
      if (!exists) {
        products.push({
          id: itemId,
          shopifyId: variant_id,
          title: title || offer.product_title,
          variant: [color, size].filter(Boolean).join(" / "),
          price: discount,
          compareAtPrice: original,
          quantity: 1,
          image: image || offer.image || null,
          is_crossell: true,
          offer_id,
        });
        const { error: updErr } = await supabase
          .from("orders")
          .update({ products })
          .eq("id", orderId);
        if (updErr) return json({ error: updErr.message }, 400);
      }

      return json({ ok: true, products });
    }

    // ---------------- REMOVE ----------------
    if (action === "remove") {
      const { variant_id } = body;
      if (!variant_id) return json({ error: "variant_id required" }, 400);

      await supabase
        .from("order_crossell_items")
        .delete()
        .eq("order_id", orderId)
        .eq("shopify_variant_id", variant_id);

      // Only remove crossell items (never the original order item)
      const next = products.filter((p) => !(p.is_crossell && p.shopifyId === variant_id));
      const { error: updErr } = await supabase
        .from("orders")
        .update({ products: next })
        .eq("id", orderId);
      if (updErr) return json({ error: updErr.message }, 400);

      return json({ ok: true, products: next });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("checkout-crossell error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
