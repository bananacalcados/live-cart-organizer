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

  // Build items using SKU codes - the edge function will look them up
  const items: YampiPaymentLinkItem[] = [];
  
  for (const product of products) {
    if (!product.sku) {
      console.error(`Product ${product.title} doesn't have a SKU`);
      continue;
    }

    items.push({
      sku: product.sku,
      quantity: product.quantity,
    });
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
