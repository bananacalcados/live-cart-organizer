import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentLinkItem {
  sku_id?: number;  // Yampi internal SKU ID (if already known)
  sku?: string;     // SKU code (will be looked up if sku_id not provided)
  shopify_variant_id?: string; // Shopify variant GID for mapping
  quantity: number;
  price?: number;
}

interface CreatePaymentLinkRequest {
  items: PaymentLinkItem[];
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  order_id?: string;
  discount_type?: 'fixed' | 'percentage';
  discount_value?: number;
  free_shipping?: boolean;
}

interface MappingRecord {
  shopify_variant_id: string;
  shopify_sku: string | null;
  yampi_sku_id: number;
}

// Initialize Supabase client with service role for internal table access
function getSupabaseClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// Fetch cached mapping from database
async function getCachedMapping(supabase: ReturnType<typeof createClient>, variantId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("shopify_yampi_mapping")
    .select("yampi_sku_id")
    .eq("shopify_variant_id", variantId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching cached mapping:", error);
    return null;
  }

  return data?.yampi_sku_id || null;
}

// Save mapping to database
async function saveMapping(supabase: ReturnType<typeof createClient>, mapping: MappingRecord): Promise<void> {
  const { error } = await supabase
    .from("shopify_yampi_mapping")
    .upsert({
      shopify_variant_id: mapping.shopify_variant_id,
      shopify_sku: mapping.shopify_sku,
      yampi_sku_id: mapping.yampi_sku_id,
    }, {
      onConflict: "shopify_variant_id",
    });

  if (error) {
    console.error("Error saving mapping:", error);
  }
}

// Fetch SKU from Shopify Admin API
async function fetchSkuFromShopify(variantId: string): Promise<string | null> {
  const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");

  if (!SHOPIFY_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    console.error("Shopify credentials not configured");
    return null;
  }

  try {
    const numericId = variantId.replace("gid://shopify/ProductVariant/", "");
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
      console.error("Shopify API error:", response.status);
      return null;
    }

    const data = await response.json();
    return data?.variant?.sku || null;
  } catch (error) {
    console.error("Error fetching SKU from Shopify:", error);
    return null;
  }
}

// Lookup Yampi sku_id by SKU code
async function lookupYampiSkuId(sku: string): Promise<number | null> {
  const YAMPI_USER_TOKEN = Deno.env.get("YAMPI_USER_TOKEN");
  const YAMPI_USER_SECRET_KEY = Deno.env.get("YAMPI_USER_SECRET_KEY");
  const YAMPI_STORE_ALIAS = Deno.env.get("YAMPI_STORE_ALIAS");

  try {
    const searchResponse = await fetch(
      `https://api.dooki.com.br/v2/${YAMPI_STORE_ALIAS}/catalog/skus?search=${encodeURIComponent(sku)}&limit=10`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Token": YAMPI_USER_TOKEN!,
          "User-Secret-Key": YAMPI_USER_SECRET_KEY!,
        },
      }
    );

    const searchData = await searchResponse.json();

    if (searchResponse.ok && searchData?.data) {
      const match = searchData.data.find((s: { sku: string }) => s.sku === sku);
      if (match) {
        return match.id;
      }
    }

    return null;
  } catch (error) {
    console.error("Error looking up Yampi sku_id:", error);
    return null;
  }
}

// Resolve Yampi sku_id with on-demand caching
async function resolveYampiSkuId(
  supabase: ReturnType<typeof createClient>,
  item: PaymentLinkItem
): Promise<{ skuId: number | null; error?: string }> {
  // If sku_id is already provided, use it
  if (item.sku_id) {
    return { skuId: item.sku_id };
  }

  const variantId = item.shopify_variant_id;

  // Check cache first if we have a variant ID
  if (variantId) {
    const cachedSkuId = await getCachedMapping(supabase, variantId);
    if (cachedSkuId) {
      console.log(`Using cached mapping for variant ${variantId}: ${cachedSkuId}`);
      return { skuId: cachedSkuId };
    }
  }

  // Get SKU (from item or fetch from Shopify)
  let sku = item.sku;
  if (!sku && variantId) {
    console.log(`Fetching SKU from Shopify for variant: ${variantId}`);
    sku = await fetchSkuFromShopify(variantId);
  }

  if (!sku) {
    return { skuId: null, error: `Could not resolve SKU for variant: ${variantId || 'unknown'}` };
  }

  // Lookup Yampi sku_id
  console.log(`Looking up Yampi sku_id for SKU: ${sku}`);
  const yampiSkuId = await lookupYampiSkuId(sku);

  if (!yampiSkuId) {
    return { skuId: null, error: `SKU not found in Yampi: ${sku}` };
  }

  // Save mapping for future use
  if (variantId) {
    await saveMapping(supabase, {
      shopify_variant_id: variantId,
      shopify_sku: sku,
      yampi_sku_id: yampiSkuId,
    });
    console.log(`Saved mapping: ${variantId} -> ${yampiSkuId}`);
  }

  return { skuId: yampiSkuId };
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

    const supabase = getSupabaseClient();
    const body: CreatePaymentLinkRequest = await req.json();
    console.log("Creating Yampi payment link with:", JSON.stringify(body, null, 2));

    if (!body.items || body.items.length === 0) {
      throw new Error("At least one item is required");
    }

    // Resolve all items to Yampi sku_ids
    const resolvedItems: Array<{ sku_id: number; quantity: number; price?: number }> = [];
    const errors: string[] = [];

    for (const item of body.items) {
      const { skuId, error } = await resolveYampiSkuId(supabase, item);
      
      if (!skuId) {
        errors.push(error || `Unknown error resolving item`);
        continue;
      }

      resolvedItems.push({
        sku_id: skuId,
        quantity: item.quantity,
        ...(item.price !== undefined && { price: item.price }),
      });
    }

    if (errors.length > 0) {
      console.error("Errors resolving items:", errors);
      throw new Error(`Failed to resolve items: ${errors.join("; ")}`);
    }

    if (resolvedItems.length === 0) {
      throw new Error("No items could be resolved to Yampi SKUs");
    }

    // Build Yampi API request
    const yampiPayload: Record<string, unknown> = {
      items: resolvedItems,
    };

    // Add customer info if provided
    if (body.customer) {
      yampiPayload.customer = {
        ...(body.customer.name && { name: body.customer.name }),
        ...(body.customer.email && { email: body.customer.email }),
        ...(body.customer.phone && { phone: body.customer.phone }),
      };
    }

    // Add discount if provided
    if (body.discount_type && body.discount_value) {
      yampiPayload.discount = {
        type: body.discount_type,
        value: body.discount_value,
      };
    }

    // Add free shipping if enabled
    if (body.free_shipping) {
      yampiPayload.free_shipping = true;
    }

    // Add metadata for tracking
    if (body.order_id) {
      yampiPayload.metadata = {
        order_id: body.order_id,
      };
    }

    console.log("Yampi API payload:", JSON.stringify(yampiPayload, null, 2));

    const yampiResponse = await fetch(
      `https://api.dooki.com.br/v2/${YAMPI_STORE_ALIAS}/checkout/payment-link`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Token": YAMPI_USER_TOKEN,
          "User-Secret-Key": YAMPI_USER_SECRET_KEY,
        },
        body: JSON.stringify(yampiPayload),
      }
    );

    const yampiData = await yampiResponse.json();
    console.log("Yampi API response:", JSON.stringify(yampiData, null, 2));

    if (!yampiResponse.ok) {
      console.error("Yampi API error:", yampiData);
      throw new Error(`Yampi API error [${yampiResponse.status}]: ${JSON.stringify(yampiData)}`);
    }

    // Extract the payment link URL from response
    const paymentLink = yampiData?.data?.url || yampiData?.data?.checkout_url || null;
    const paymentLinkId = yampiData?.data?.id || null;

    if (!paymentLink) {
      console.error("No payment link in response:", yampiData);
      throw new Error("Payment link not found in Yampi response");
    }

    return new Response(
      JSON.stringify({
        success: true,
        payment_link: paymentLink,
        payment_link_id: paymentLinkId,
        data: yampiData.data,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating payment link:", error);
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
