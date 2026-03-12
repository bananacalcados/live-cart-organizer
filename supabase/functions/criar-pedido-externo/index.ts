import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key",
};

const AGENT_KEY = Deno.env.get("MCP_AGENT_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const agentKey = req.headers.get("x-agent-key");
    if (agentKey !== AGENT_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      evento_id,
      cliente_instagram,
      cliente_whatsapp,
      produto_shopify_id,
      variante_sku,
      tamanho,
      cor,
      observacao,
    } = body;

    console.log("Received external order:", JSON.stringify(body));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determine completeness
    const missingFields: string[] = [];
    if (!evento_id) missingFields.push("evento_id");
    if (!cliente_instagram) missingFields.push("cliente_instagram");
    if (!cliente_whatsapp) missingFields.push("cliente_whatsapp");
    if (!produto_shopify_id && !variante_sku) missingFields.push("produto");
    if (!tamanho && !cor && !variante_sku) missingFields.push("tamanho/cor");

    const isComplete = missingFields.length === 0;
    const stage = isComplete ? "awaiting_confirmation" : "incomplete_order";

    // Normalize instagram handle
    const instagram = (cliente_instagram || "desconhecido").replace(/^@/, "");

    // Find or create customer
    let customerId: string;
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("instagram_handle", instagram)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      // Update whatsapp if provided
      if (cliente_whatsapp) {
        await supabase
          .from("customers")
          .update({ whatsapp: cliente_whatsapp })
          .eq("id", customerId);
      }
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from("customers")
        .insert({
          instagram_handle: instagram,
          whatsapp: cliente_whatsapp || null,
          is_banned: false,
        })
        .select("id")
        .single();

      if (custErr) throw new Error(`Customer creation failed: ${custErr.message}`);
      customerId = newCustomer.id;
    }

    // Build product array
    let products: any[] = [];

    if (produto_shopify_id || variante_sku) {
      // Try to fetch product info from Shopify Storefront API
      const SHOPIFY_STORE = "ftx2e2-np.myshopify.com";
      const SHOPIFY_TOKEN = "01d9be4b81f3be57729bc07e9d552252";

      let variantTitle = [tamanho, cor].filter(Boolean).join(" / ") || "";
      let productTitle = "Produto";
      let price = 0;
      let compareAtPrice: number | undefined;
      let image: string | undefined;
      let shopifyVariantId = "";
      let sku = variante_sku || "";

      if (produto_shopify_id) {
        try {
          const numericId = produto_shopify_id.replace("gid://shopify/Product/", "");
          const gql = `{
            product(id: "gid://shopify/Product/${numericId}") {
              title
              images(first: 1) { edges { node { url } } }
              variants(first: 100) {
                edges {
                  node {
                    id title sku
                    price { amount }
                    compareAtPrice { amount }
                    image { url }
                    selectedOptions { name value }
                  }
                }
              }
            }
          }`;

          const sfRes = await fetch(
            `https://${SHOPIFY_STORE}/api/2025-07/graphql.json`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN,
              },
              body: JSON.stringify({ query: gql }),
            }
          );

          const sfData = await sfRes.json();
          const product = sfData?.data?.product;

          if (product) {
            productTitle = product.title;
            image = product.images?.edges?.[0]?.node?.url;

            // Find variant by SKU first, then by title match
            const variants = product.variants?.edges || [];
            let matched = null;

            if (variante_sku) {
              matched = variants.find(
                (v: any) => v.node.sku?.toLowerCase() === variante_sku.toLowerCase()
              );
            }

            if (!matched && (tamanho || cor)) {
              matched = variants.find((v: any) => {
                const opts = v.node.selectedOptions || [];
                const matchTamanho = !tamanho || opts.some((o: any) =>
                  o.value.toLowerCase() === tamanho.toLowerCase()
                );
                const matchCor = !cor || opts.some((o: any) =>
                  o.value.toLowerCase() === cor.toLowerCase()
                );
                return matchTamanho && matchCor;
              });
            }

            if (!matched && variants.length > 0) {
              matched = variants[0];
            }

            if (matched) {
              shopifyVariantId = matched.node.id;
              sku = matched.node.sku || sku;
              price = parseFloat(matched.node.price?.amount || "0");
              compareAtPrice = matched.node.compareAtPrice
                ? parseFloat(matched.node.compareAtPrice.amount)
                : undefined;
              variantTitle = matched.node.title !== "Default Title"
                ? matched.node.title
                : variantTitle;
              if (matched.node.image?.url) {
                image = matched.node.image.url;
              }
            }
          }
        } catch (e) {
          console.error("Shopify lookup failed:", e);
        }
      }

      products = [
        {
          id: crypto.randomUUID(),
          shopifyId: shopifyVariantId || produto_shopify_id || "",
          sku: sku || undefined,
          title: productTitle,
          variant: variantTitle,
          price,
          compareAtPrice: compareAtPrice && compareAtPrice > price ? compareAtPrice : undefined,
          quantity: 1,
          image,
        },
      ];
    }

    // Create order
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        event_id: evento_id || null,
        customer_id: customerId,
        products: products,
        stage,
        notes: observacao || null,
      })
      .select("id, stage")
      .single();

    if (orderErr) throw new Error(`Order creation failed: ${orderErr.message}`);

    // Set cart link
    const cartLink = `https://checkout.bananacalcados.com.br/checkout/order/${order.id}`;
    await supabase
      .from("orders")
      .update({ cart_link: cartLink })
      .eq("id", order.id);

    console.log("Order created:", order.id, "stage:", order.stage);

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        stage: order.stage,
        is_complete: isComplete,
        missing_fields: missingFields.length > 0 ? missingFields : undefined,
        cart_link: cartLink,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating external order:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
