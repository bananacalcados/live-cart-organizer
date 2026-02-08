import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentLinkItem {
  sku_id?: number;  // Yampi internal SKU ID
  sku?: string;     // SKU code (will be looked up if sku_id not provided)
  quantity: number;
  price?: number; // Optional: override price
}

interface CreatePaymentLinkRequest {
  items: PaymentLinkItem[];
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  order_id?: string; // Internal order ID for tracking
  discount_type?: 'fixed' | 'percentage';
  discount_value?: number;
  free_shipping?: boolean;
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

    const body: CreatePaymentLinkRequest = await req.json();
    console.log("Creating Yampi payment link with:", JSON.stringify(body, null, 2));

    if (!body.items || body.items.length === 0) {
      throw new Error("At least one item is required");
    }

    // Resolve SKU codes to Yampi sku_ids if needed
    const resolvedItems: Array<{ sku_id: number; quantity: number; price?: number }> = [];
    
    for (const item of body.items) {
      let skuId = item.sku_id;
      
      // If no sku_id but has sku code, look it up
      if (!skuId && item.sku) {
        console.log(`Looking up SKU: ${item.sku}`);
        const searchResponse = await fetch(
          `https://api.dooki.com.br/v2/${YAMPI_STORE_ALIAS}/catalog/skus?search=${encodeURIComponent(item.sku)}&limit=10`,
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
        console.log(`Yampi search result for SKU ${item.sku}:`, JSON.stringify(searchData, null, 2));

        if (searchResponse.ok && searchData?.data) {
          // Find exact SKU match
          const match = searchData.data.find((s: { sku: string }) => s.sku === item.sku);
          if (match) {
            skuId = match.id;
            console.log(`Found Yampi sku_id ${skuId} for SKU ${item.sku}`);
          }
        }
      }

      if (!skuId) {
        throw new Error(`Could not find Yampi SKU ID for SKU: ${item.sku || 'unknown'}`);
      }

      resolvedItems.push({
        sku_id: skuId,
        quantity: item.quantity,
        ...(item.price !== undefined && { price: item.price }),
      });
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
