import { supabase } from "@/integrations/supabase/client";
import { DbOrderProduct } from "@/types/database";

interface YampiPaymentLinkItem {
  sku?: string;      // SKU code (preferred - will be looked up automatically)
  sku_id?: number;   // Yampi internal SKU ID (if already known)
  quantity: number;
  price?: number;
}

interface YampiCustomer {
  name?: string;
  email?: string;
  phone?: string;
}

interface CreateYampiPaymentLinkRequest {
  items: YampiPaymentLinkItem[];
  customer?: YampiCustomer;
  order_id?: string;
  discount_type?: 'fixed' | 'percentage';
  discount_value?: number;
  free_shipping?: boolean;
}

interface YampiPaymentLinkResponse {
  success: boolean;
  payment_link?: string;
  payment_link_id?: string;
  error?: string;
}

interface MappingRecord {
  shopify_variant_id: string;
  shopify_sku: string | null;
  yampi_sku_id: number;
}

/**
 * Get cached mapping from database
 */
async function getCachedMapping(variantId: string): Promise<number | null> {
  console.log("[Yampi] Checking cached mapping for variant:", variantId);
  
  const { data, error } = await supabase
    .from("shopify_yampi_mapping")
    .select("yampi_sku_id")
    .eq("shopify_variant_id", variantId)
    .maybeSingle();

  if (error) {
    console.error("[Yampi] Error fetching cached mapping:", error);
    return null;
  }

  if (data) {
    console.log("[Yampi] Found cached mapping:", data.yampi_sku_id);
    return data.yampi_sku_id;
  }

  console.log("[Yampi] No cached mapping found");
  return null;
}

/**
 * Save mapping to database for future use
 */
async function saveMapping(mapping: MappingRecord): Promise<void> {
  console.log("[Yampi] Saving mapping:", mapping);
  
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
    console.error("[Yampi] Error saving mapping:", error);
  } else {
    console.log("[Yampi] Mapping saved successfully");
  }
}

/**
 * Fetch SKU from Shopify Admin API for a specific variant ID
 */
async function fetchSkuFromShopifyAdmin(variantId: string): Promise<string | null> {
  try {
    console.log("[Yampi] Fetching SKU from Shopify Admin API for variant:", variantId);
    
    const { data, error } = await supabase.functions.invoke("shopify-get-variant-sku", {
      body: { variantId },
    });

    if (error) {
      console.error("[Yampi] Error calling shopify-get-variant-sku:", error);
      return null;
    }

    if (data?.success && data?.sku) {
      console.log("[Yampi] Found SKU:", data.sku);
      return data.sku;
    }

    console.log("[Yampi] No SKU returned from Shopify Admin API:", data);
    return null;
  } catch (error) {
    console.error("[Yampi] Error fetching SKU from Shopify Admin:", error);
    return null;
  }
}

/**
 * Lookup Yampi sku_id by SKU code
 */
async function lookupYampiSkuId(sku: string): Promise<number | null> {
  try {
    console.log("[Yampi] Looking up Yampi sku_id for SKU:", sku);
    
    const { data, error } = await supabase.functions.invoke("yampi-lookup-sku", {
      body: { skus: [sku] },
    });

    if (error) {
      console.error("[Yampi] Error calling yampi-lookup-sku:", error);
      return null;
    }

    if (data?.success && data?.results?.length > 0) {
      const result = data.results[0];
      if (result.found && result.sku_id) {
        console.log("[Yampi] Found sku_id:", result.sku_id);
        return result.sku_id;
      }
    }

    console.log("[Yampi] SKU not found in Yampi:", sku);
    return null;
  } catch (error) {
    console.error("[Yampi] Error looking up Yampi sku_id:", error);
    return null;
  }
}

/**
 * Resolve Yampi sku_id for a product variant (on-demand with caching)
 * 
 * Flow:
 * 1. Check cache (database mapping table)
 * 2. If not cached, get SKU from product or Shopify Admin API
 * 3. Lookup sku_id in Yampi
 * 4. Save mapping to cache for future use
 */
async function resolveYampiSkuId(product: DbOrderProduct): Promise<number | null> {
  console.log("[Yampi] Resolving Yampi sku_id for product:", product.title, "| variant:", product.variant);

  // Extract variant ID
  let variantId = product.shopifyId;
  
  // If shopifyId is a Product GID (not variant), try to extract variant from composite id
  if (variantId?.includes("gid://shopify/Product/") && !variantId.includes("ProductVariant")) {
    const parts = product.id.split("-");
    const maybeVariant = parts.find(p => p.includes("gid://shopify/ProductVariant/"));
    if (maybeVariant) {
      variantId = maybeVariant;
    }
  }

  if (!variantId?.includes("gid://shopify/ProductVariant/")) {
    console.error(`[Yampi] Invalid variant ID for product: ${product.title}`, variantId);
    return null;
  }

  // Step 1: Check cache
  const cachedSkuId = await getCachedMapping(variantId);
  if (cachedSkuId) {
    return cachedSkuId;
  }

  // Step 2: Get SKU (from product or Shopify Admin API)
  let sku = product.sku;
  if (!sku) {
    sku = await fetchSkuFromShopifyAdmin(variantId);
  }

  if (!sku) {
    console.error(`[Yampi] Could not resolve SKU for product: ${product.title}`);
    return null;
  }

  // Step 3: Lookup Yampi sku_id
  const yampiSkuId = await lookupYampiSkuId(sku);
  if (!yampiSkuId) {
    console.error(`[Yampi] SKU not found in Yampi: ${sku}`);
    return null;
  }

  // Step 4: Save mapping for future use
  await saveMapping({
    shopify_variant_id: variantId,
    shopify_sku: sku,
    yampi_sku_id: yampiSkuId,
  });

  return yampiSkuId;
}

/**
 * Creates a payment link using Yampi API (direct call with sku_ids)
 */
export async function createYampiPaymentLink(
  request: CreateYampiPaymentLinkRequest
): Promise<YampiPaymentLinkResponse> {
  try {
    const { data, error } = await supabase.functions.invoke("yampi-create-payment-link", {
      body: request,
    });

    if (error) {
      console.error("Error calling Yampi edge function:", error);
      return { success: false, error: error.message };
    }

    return data as YampiPaymentLinkResponse;
  } catch (error) {
    console.error("Failed to create Yampi payment link:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Creates a Yampi payment link from order products
 * Uses on-demand mapping: checks cache → resolves → saves for future
 */
export async function createYampiPaymentLinkFromOrder(
  products: DbOrderProduct[],
  options?: {
    orderId?: string;
    customerPhone?: string;
    customerName?: string;
    discountType?: 'fixed' | 'percentage';
    discountValue?: number;
    freeShipping?: boolean;
  }
): Promise<string | null> {
  if (products.length === 0) {
    console.error("No products provided");
    return null;
  }

  // Build items using resolved Yampi sku_ids
  const items: YampiPaymentLinkItem[] = [];
  const failedProducts: string[] = [];
  
  for (const product of products) {
    const yampiSkuId = await resolveYampiSkuId(product);
    
    if (!yampiSkuId) {
      const productLabel = product.variant 
        ? `${product.title} (${product.variant})`
        : product.title;
      failedProducts.push(productLabel);
      continue;
    }

    items.push({
      sku_id: yampiSkuId,
      quantity: product.quantity,
    });
  }

  if (failedProducts.length > 0) {
    console.error("Products without Yampi mapping:", failedProducts);
    throw new Error(`Produtos não encontrados na Yampi: ${failedProducts.join(", ")}`);
  }

  if (items.length === 0) {
    console.error("No products with valid Yampi sku_ids found");
    return null;
  }

  const request: CreateYampiPaymentLinkRequest = {
    items,
    order_id: options?.orderId,
  };

  // Add customer info if provided
  if (options?.customerPhone || options?.customerName) {
    request.customer = {
      name: options.customerName,
      phone: options.customerPhone,
    };
  }

  // Add discount if provided
  if (options?.discountType && options?.discountValue) {
    request.discount_type = options.discountType;
    request.discount_value = options.discountValue;
  }

  // Add free shipping if enabled
  if (options?.freeShipping) {
    request.free_shipping = true;
  }

  const response = await createYampiPaymentLink(request);

  if (!response.success || !response.payment_link) {
    console.error("Failed to create Yampi payment link:", response.error);
    return null;
  }

  return response.payment_link;
}

/**
 * Get the Yampi webhook URL for configuration
 */
export function getYampiWebhookUrl(): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/yampi-webhook`;
}
