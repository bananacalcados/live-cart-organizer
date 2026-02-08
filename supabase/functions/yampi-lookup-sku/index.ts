import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LookupSkuRequest {
  skus: string[]; // Array of SKU codes to lookup
}

interface YampiSkuResult {
  sku: string;
  sku_id: number | null;
  found: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const YAMPI_USER_TOKEN = Deno.env.get("YAMPI_USER_TOKEN");
    const YAMPI_USER_SECRET_KEY = Deno.env.get("YAMPI_USER_SECRET_KEY");
    const YAMPI_STORE_ALIAS = Deno.env.get("YAMPI_STORE_ALIAS");

    if (!YAMPI_USER_TOKEN) {
      throw new Error("YAMPI_USER_TOKEN is not configured");
    }
    if (!YAMPI_USER_SECRET_KEY) {
      throw new Error("YAMPI_USER_SECRET_KEY is not configured");
    }
    if (!YAMPI_STORE_ALIAS) {
      throw new Error("YAMPI_STORE_ALIAS is not configured");
    }

    const body: LookupSkuRequest = await req.json();
    console.log("Looking up Yampi SKUs:", body.skus);

    if (!body.skus || body.skus.length === 0) {
      throw new Error("At least one SKU is required");
    }

    const results: YampiSkuResult[] = [];

    // Lookup each SKU in Yampi
    for (const sku of body.skus) {
      try {
        // Search for SKU in Yampi catalog
        const searchResponse = await fetch(
          `https://api.dooki.com.br/v2/${YAMPI_STORE_ALIAS}/catalog/skus?search=${encodeURIComponent(sku)}&limit=1`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "User-Token": YAMPI_USER_TOKEN,
              "User-Secret-Key": YAMPI_USER_SECRET_KEY,
            },
          }
        );

        const searchData = await searchResponse.json();
        console.log(`Yampi search result for SKU ${sku}:`, JSON.stringify(searchData, null, 2));

        if (!searchResponse.ok) {
          console.error(`Yampi API error for SKU ${sku}:`, searchData);
          results.push({ sku, sku_id: null, found: false });
          continue;
        }

        // Check if we found a matching SKU
        const skuData = searchData?.data?.[0];
        if (skuData && skuData.sku === sku) {
          results.push({
            sku,
            sku_id: skuData.id,
            found: true,
          });
        } else {
          results.push({ sku, sku_id: null, found: false });
        }
      } catch (error) {
        console.error(`Error looking up SKU ${sku}:`, error);
        results.push({ sku, sku_id: null, found: false });
      }
    }

    console.log("Lookup results:", results);

    return new Response(
      JSON.stringify({
        success: true,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error looking up SKUs:", error);
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
