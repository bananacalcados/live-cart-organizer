import { supabase } from "@/integrations/supabase/client";
import { OrderProduct } from "@/types/order";

interface YampiPaymentLinkItem {
  sku_id: number;
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
 * Note: This requires products to have a Yampi SKU ID stored
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
 * This function handles the conversion from Shopify product IDs to Yampi SKU IDs
 * 
 * IMPORTANT: For this to work, you need to have the Yampi SKU IDs mapped
 * Currently returns null if products don't have Yampi SKU IDs
 */
export async function createYampiPaymentLinkFromOrder(
  products: OrderProduct[],
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

  // For now, we'll use a simple mapping approach
  // In the future, you may want to store Yampi SKU IDs in the product data
  // or have a mapping table in the database
  
  // Check if products have yampiSkuId (needs to be added to product selection)
  const items: YampiPaymentLinkItem[] = [];
  
  for (const product of products) {
    // Try to extract Yampi SKU ID from product
    // Option 1: If stored in product data (requires update to ProductSelector)
    // Option 2: If the Shopify variant ID can be used
    // Option 3: Manual mapping
    
    // For now, we'll attempt to use a numeric ID from the shopifyId
    // This is a placeholder - you'll need to implement proper SKU mapping
    const skuMatch = product.shopifyId?.match(/\d+$/);
    
    if (!skuMatch) {
      console.error(`Product ${product.title} doesn't have a valid SKU ID`);
      continue;
    }

    items.push({
      sku_id: parseInt(skuMatch[0], 10),
      quantity: product.quantity,
      price: product.price, // Optional: can override price
    });
  }

  if (items.length === 0) {
    console.error("No valid items to create payment link");
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
