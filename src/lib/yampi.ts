import { supabase } from "@/integrations/supabase/client";
import { DbOrderProduct } from "@/types/database";

interface YampiPaymentLinkItem {
  sku?: string;
  sku_id?: number;
  shopify_variant_id?: string;
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
  coupon_code?: string;
}

interface YampiPaymentLinkResponse {
  success: boolean;
  payment_link?: string;
  payment_link_id?: string;
  error?: string;
}

/**
 * Extract variant ID from product
 */
function extractVariantId(product: DbOrderProduct): string | null {
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
    return null;
  }

  return variantId;
}

/**
 * Creates a payment link using Yampi API
 * The edge function handles all SKU resolution and caching internally
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
 * Sends variant IDs and SKUs to the edge function which handles resolution
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
    couponCode?: string;
  }
): Promise<string | null> {
  if (products.length === 0) {
    console.error("No products provided");
    return null;
  }

  // Build items with variant IDs, SKUs and prices for backend resolution
  const items: YampiPaymentLinkItem[] = products.map(product => {
    const variantId = extractVariantId(product);
    
    return {
      sku: product.sku || undefined,
      shopify_variant_id: variantId || undefined,
      quantity: product.quantity,
      price: product.price, // Send price so backend can apply discounts
    };
  });

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

  // Add coupon code if provided
  if (options?.couponCode) {
    request.coupon_code = options.couponCode;
  }

  const response = await createYampiPaymentLink(request);

  if (!response.success || !response.payment_link) {
    console.error("Failed to create Yampi payment link:", response.error);
    throw new Error(response.error || "Erro ao criar link Yampi");
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
