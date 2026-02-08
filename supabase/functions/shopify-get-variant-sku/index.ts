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
    const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!SHOPIFY_ACCESS_TOKEN) {
      throw new Error("SHOPIFY_ACCESS_TOKEN is not configured");
    }

    // Get store domain from storefront token environment or use default
    const SHOPIFY_STORE_DOMAIN = "ftx2e2-np.myshopify.com";

    const body = await req.json();
    const { variantId } = body;

    if (!variantId) {
      throw new Error("variantId is required");
    }

    console.log("Fetching SKU for variant:", variantId);

    // Extract numeric ID from GID
    const numericId = variantId.replace("gid://shopify/ProductVariant/", "");

    // Use Shopify Admin REST API to get variant details
    const response = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/variants/${numericId}.json`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Shopify Admin API error:", response.status, errorText);
      throw new Error(`Shopify Admin API error [${response.status}]: ${errorText}`);
    }

    const data = await response.json();
    console.log("Shopify variant data:", JSON.stringify(data, null, 2));

    const sku = data?.variant?.sku || null;
    const title = data?.variant?.title || null;

    return new Response(
      JSON.stringify({
        success: true,
        sku,
        title,
        variantId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching variant SKU:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
