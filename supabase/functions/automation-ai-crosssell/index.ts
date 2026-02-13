import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const {
      mode,
      customerName,
      customerPhone,
      purchasedProducts,
      productPool,
      crosssellPrompt,
      crosssellIntro,
      discountPercent,
      messages,
      selectedProductHandle,
      selectedVariant,
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Mode: suggest - AI suggests a product from the pool
    if (mode === 'suggest') {
      const systemPrompt = crosssellPrompt || `Você é consultora de vendas da Banana Calçados. O cliente acabou de comprar: ${purchasedProducts}. 
Sugira UM produto complementar da lista disponível abaixo. Explique brevemente por que combina com a compra.
Seja simpática, use emojis e mantenha a mensagem curta.
${discountPercent > 0 ? `Ofereça ${discountPercent}% de desconto exclusivo.` : ''}

Produtos disponíveis para sugestão:
${(productPool || []).join(', ')}`;

      const chatMessages = [
        { role: 'system', content: systemPrompt },
        ...(messages || []),
      ];

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: chatMessages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: 'Rate limit excedido.' }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: 'Créditos insuficientes.' }), {
            status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const errorText = await response.text();
        console.error('AI gateway error:', status, errorText);
        return new Response(JSON.stringify({ error: 'Erro no serviço de IA' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || '';

      return new Response(JSON.stringify({ success: true, reply }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mode: generate_link - Generate Yampi checkout link for selected product+variant
    if (mode === 'generate_link') {
      if (!selectedProductHandle || !selectedVariant) {
        return new Response(JSON.stringify({ error: 'Product handle and variant are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get Yampi credentials
      const yampiAlias = Deno.env.get('YAMPI_ALIAS');
      const yampiToken = Deno.env.get('YAMPI_API_TOKEN');

      if (!yampiAlias || !yampiToken) {
        return new Response(JSON.stringify({ error: 'Yampi credentials not configured' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Look up the SKU mapping from Shopify handle to Yampi
      const { data: mapping } = await supabase
        .from('shopify_yampi_mapping')
        .select('yampi_sku_id, yampi_product_id')
        .eq('shopify_handle', selectedProductHandle)
        .eq('variant_label', selectedVariant)
        .maybeSingle();

      let yampiSkuId = mapping?.yampi_sku_id;

      if (!yampiSkuId) {
        // Try to find by Shopify variant info through the API
        console.log(`No mapping found for ${selectedProductHandle} / ${selectedVariant}, trying API lookup...`);
        
        // Try Yampi search by product name
        const searchRes = await fetch(
          `https://api.dooki.com.br/v2/${yampiAlias}/catalog/products?search=${encodeURIComponent(selectedProductHandle)}&limit=5`,
          { headers: { 'Authorization': `Bearer ${yampiToken}`, 'Content-Type': 'application/json' } }
        );

        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const products = searchData.data || [];
          
          for (const product of products) {
            // Get SKUs for this product
            const skuRes = await fetch(
              `https://api.dooki.com.br/v2/${yampiAlias}/catalog/products/${product.id}/skus`,
              { headers: { 'Authorization': `Bearer ${yampiToken}`, 'Content-Type': 'application/json' } }
            );
            
            if (skuRes.ok) {
              const skuData = await skuRes.json();
              const skus = skuData.data || [];
              
              // Find matching variant
              const matchingSku = skus.find((s: any) => {
                const variations = s.variations?.data || [];
                return variations.some((v: any) => 
                  v.value?.toLowerCase() === selectedVariant.toLowerCase() ||
                  v.name?.toLowerCase() === selectedVariant.toLowerCase()
                );
              });
              
              if (matchingSku) {
                yampiSkuId = matchingSku.id;
                
                // Save mapping for future use
                await supabase.from('shopify_yampi_mapping').insert({
                  shopify_handle: selectedProductHandle,
                  variant_label: selectedVariant,
                  yampi_sku_id: matchingSku.id,
                  yampi_product_id: product.id,
                }).onConflict('shopify_handle,variant_label').ignore();
                
                break;
              }
            }
          }
        }
      }

      if (!yampiSkuId) {
        return new Response(JSON.stringify({ 
          error: 'Não foi possível encontrar o produto na Yampi. Verifique o cadastro.',
          needsManualLink: true,
        }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate Yampi payment link
      const linkPayload: any = {
        skus: [{ sku_id: yampiSkuId, quantity: 1 }],
      };

      // Don't add phone to avoid session conflicts (per memory)
      if (customerName) {
        linkPayload.customer = { name: customerName };
      }

      const linkRes = await fetch(
        `https://api.dooki.com.br/v2/${yampiAlias}/checkout/payment-links`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${yampiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(linkPayload),
        }
      );

      if (!linkRes.ok) {
        const errorBody = await linkRes.text();
        console.error('Yampi link creation error:', errorBody);
        return new Response(JSON.stringify({ error: 'Erro ao gerar link Yampi', details: errorBody }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const linkData = await linkRes.json();
      const checkoutUrl = linkData.data?.url || linkData.url;

      return new Response(JSON.stringify({ 
        success: true, 
        checkoutUrl,
        productHandle: selectedProductHandle,
        variant: selectedVariant,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid mode. Use "suggest" or "generate_link".' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Cross-sell error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
