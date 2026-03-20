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
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    if (!shopifyDomain || !shopifyToken) {
      throw new Error("Shopify credentials not configured");
    }

    const { orderId } = await req.json();

    // Create a simple test product on Shopify
    const productPayload = {
      product: {
        title: "Produto Teste R$10",
        body_html: "<p>Produto de teste para simulação de checkout</p>",
        vendor: "Teste",
        product_type: "Teste",
        tags: "teste,dev",
        variants: [
          {
            title: "Default",
            price: "10.00",
            sku: "TESTE-10",
            inventory_management: null,
            requires_shipping: false,
          },
        ],
      },
    };

    console.log("Creating test product on Shopify...");

    const response = await fetch(
      `https://${shopifyDomain}/admin/api/2025-01/products.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify(productPayload),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Shopify error:", errorBody);
      throw new Error(`Shopify API error ${response.status}: ${errorBody}`);
    }

    const result = await response.json();
    const product = result.product;
    const variant = product.variants[0];

    console.log("Product created:", product.id, "Variant:", variant.id);

    const shopifyVariantGid = `gid://shopify/ProductVariant/${variant.id}`;
    const shopifyProductGid = `gid://shopify/Product/${product.id}`;

    // Update the order in DB if orderId provided
    if (orderId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const updatedProducts = [
        {
          id: `${shopifyProductGid}-${shopifyVariantGid}`,
          shopifyId: shopifyVariantGid,
          sku: "TESTE-10",
          title: "Produto Teste R$10",
          variant: "Default",
          price: 10,
          quantity: 1,
          image: product.image?.src || "",
        },
      ];

      await supabase
        .from("orders")
        .update({ products: updatedProducts })
        .eq("id", orderId);

      console.log("Order updated with Shopify variant ID");
    }

    return new Response(
      JSON.stringify({
        success: true,
        productId: product.id,
        variantId: variant.id,
        shopifyVariantGid,
        shopifyProductGid,
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
