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

/**
 * Fetch SKU from Shopify Admin API for a specific variant ID
 * Uses edge function to securely access Admin API
 */
async function fetchSkuFromShopifyAdmin(variantId: string): Promise<string | null> {
  try {
    console.log("Fetching SKU from Shopify Admin API for variant:", variantId);
    
    const { data, error } = await supabase.functions.invoke("shopify-get-variant-sku", {
      body: { variantId },
    });

    if (error) {
      console.error("Error calling shopify-get-variant-sku:", error);
      return null;
    }

    if (data?.success && data?.sku) {
      console.log("Found SKU:", data.sku);
      return data.sku;
    }

    console.log("No SKU returned from Shopify Admin API");
    return null;
  } catch (error) {
    console.error("Error fetching SKU from Shopify Admin:", error);
    return null;
  }
}

/**
 * Resolve SKU for a product - uses stored SKU or fetches from Shopify Admin API
 */
async function resolveProductSku(product: DbOrderProduct): Promise<string | null> {
  // If product already has SKU, use it
  if (product.sku) {
    return product.sku;
  }

  // Try to extract variant ID from shopifyId or composite id
  let variantId = product.shopifyId;
  
  // If shopifyId is a Product GID, try to extract variant from composite id
  if (variantId?.includes("gid://shopify/Product/")) {
    const parts = product.id.split("-");
    const maybeVariant = parts[parts.length - 1];
    if (maybeVariant?.includes("gid://shopify/ProductVariant/")) {
      variantId = maybeVariant;
    } else {
      console.error(`Cannot resolve variant ID for product: ${product.title}`);
      return null;
    }
  }

  if (!variantId?.includes("gid://shopify/ProductVariant/")) {
    console.error(`Invalid variant ID for product: ${product.title}`);
    return null;
  }

  // Fetch SKU from Shopify Admin API
  const sku = await fetchSkuFromShopifyAdmin(variantId);
  
  if (!sku) {
    console.error(`No SKU found in Shopify for product: ${product.title} (${product.variant})`);
  }
  
  return sku;
}

/**
 * Creates a payment link using Yampi API
 * Can accept either SKU codes (which will be looked up) or direct sku_ids
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
 * Creates a Yampi payment link from order products using SKU codes
 * The edge function will automatically lookup the Yampi sku_id for each SKU
 * This function also handles products that don't have SKU saved by fetching from Shopify
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

  // Build items using SKU codes - resolve missing SKUs from Shopify
  const items: YampiPaymentLinkItem[] = [];
  const missingSkuProducts: string[] = [];
  
  for (const product of products) {
    // Resolve SKU (from stored value or fetch from Shopify)
    const sku = await resolveProductSku(product);
    
    if (!sku) {
      const productLabel = product.variant 
        ? `${product.title} (${product.variant})`
        : product.title;
      missingSkuProducts.push(productLabel);
      continue;
    }

    items.push({
      sku,
      quantity: product.quantity,
    });
  }

  if (missingSkuProducts.length > 0) {
    console.error("Products without SKU:", missingSkuProducts);
    throw new Error(`Produtos sem SKU: ${missingSkuProducts.join(", ")}`);
  }

  if (items.length === 0) {
    console.error("No products with valid SKUs found");
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
