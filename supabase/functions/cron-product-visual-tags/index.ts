import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10;
const VISUAL_TAG_CATEGORIES = [
  'solado_baixo', 'solado_alto', 'chunky', 'plataforma',
  'bico_fino', 'bico_redondo', 'bico_quadrado',
  'minimalista', 'casual', 'esportivo', 'social', 'elegante',
  'salto_alto', 'salto_baixo', 'rasteira', 'sem_salto',
  'tira', 'fivela', 'cadarco', 'slip_on', 'velcro',
  'couro', 'sintetico', 'tecido', 'camurca',
  'aberto', 'fechado', 'meia_pata',
  'ortopedico', 'conforto', 'anatomico',
  'leve', 'robusto', 'delicado',
  'cores_neutras', 'cores_vibrantes', 'estampado', 'metalizado',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const onlyNew = body.only_new !== false; // default: only analyze new/updated products
    const forceAll = body.force_all === true;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
    const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!shopifyDomain || !shopifyToken) {
      return new Response(JSON.stringify({ error: 'Shopify credentials not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get existing tags to skip already-analyzed products
    const { data: existingTags } = await supabase
      .from('product_visual_tags')
      .select('shopify_product_id, analyzed_image_urls, last_analyzed_at');

    const existingMap = new Map<string, { urls: string[]; analyzedAt: string }>();
    for (const t of existingTags || []) {
      existingMap.set(t.shopify_product_id, {
        urls: t.analyzed_image_urls || [],
        analyzedAt: t.last_analyzed_at,
      });
    }

    // Fetch all products from Shopify (paginated)
    let hasNextPage = true;
    let cursor: string | null = null;
    const allProducts: any[] = [];

    while (hasNextPage) {
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const graphql = `{
        products(first: 50${afterClause}) {
          pageInfo { hasNextPage }
          edges {
            cursor
            node {
              id
              title
              images(first: 5) {
                edges { node { url altText } }
              }
              updatedAt
            }
          }
        }
      }`;

      const resp = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopifyToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: graphql }),
      });

      const data = await resp.json();
      const edges = data?.data?.products?.edges || [];
      for (const edge of edges) {
        allProducts.push(edge.node);
        cursor = edge.cursor;
      }
      hasNextPage = data?.data?.products?.pageInfo?.hasNextPage || false;

      // Safety limit
      if (allProducts.length > 2000) break;
    }

    console.log(`[visual-tags] Found ${allProducts.length} total products from Shopify`);

    // Filter to only products that need analysis
    const productsToAnalyze: any[] = [];
    for (const product of allProducts) {
      const images = (product.images?.edges || []).map((e: any) => e.node.url).filter(Boolean);
      if (images.length === 0) continue; // skip products without images

      const existing = existingMap.get(product.id);
      if (forceAll) {
        productsToAnalyze.push({ ...product, imageUrls: images });
        continue;
      }

      if (!existing) {
        // New product, never analyzed
        productsToAnalyze.push({ ...product, imageUrls: images });
        continue;
      }

      if (!onlyNew) {
        // Check if images changed
        const currentUrls = images.sort().join(',');
        const existingUrls = (existing.urls || []).sort().join(',');
        if (currentUrls !== existingUrls) {
          productsToAnalyze.push({ ...product, imageUrls: images });
        }
      }
    }

    console.log(`[visual-tags] ${productsToAnalyze.length} products need analysis`);

    if (productsToAnalyze.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'All products already analyzed, nothing to do',
        total_products: allProducts.length,
        analyzed: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process in batches
    let analyzed = 0;
    let errors = 0;

    for (let i = 0; i < productsToAnalyze.length; i += BATCH_SIZE) {
      const batch = productsToAnalyze.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (product: any) => {
          try {
            const imageUrls = product.imageUrls.slice(0, 3); // max 3 images per product
            const imageContent = imageUrls.map((url: string) => ({
              type: 'image_url',
              image_url: { url },
            }));

            const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash-lite',
                messages: [
                  {
                    role: 'system',
                    content: `Você é um especialista em calçados analisando fotos de produtos para gerar tags visuais.

Analise as imagens do produto "${product.title}" e retorne um JSON com:
1. "tags": array de tags visuais aplicáveis (APENAS das tags permitidas abaixo)
2. "description": descrição visual curta (máx 100 palavras) focando em: tipo de solado (alto/baixo/chunky), estilo, material aparente, tipo de fechamento, conforto visual

Tags permitidas: ${VISUAL_TAG_CATEGORIES.join(', ')}

Responda SOMENTE com o JSON, sem markdown, sem explicações extras.
Exemplo: {"tags":["solado_baixo","casual","slip_on","leve","cores_neutras"],"description":"Tênis casual de solado fino e baixo..."}`,
                  },
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: `Analise as fotos do produto "${product.title}" e gere as tags visuais.` },
                      ...imageContent,
                    ],
                  },
                ],
                stream: false,
              }),
            });

            if (!aiResponse.ok) {
              const errText = await aiResponse.text();
              throw new Error(`AI error ${aiResponse.status}: ${errText}`);
            }

            const aiData = await aiResponse.json();
            let rawContent = aiData.choices?.[0]?.message?.content || '';

            // Clean markdown wrapping if present
            rawContent = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

            const parsed = JSON.parse(rawContent);
            const tags = (parsed.tags || []).filter((t: string) => VISUAL_TAG_CATEGORIES.includes(t));
            const description = parsed.description || '';

            // Upsert to database
            await supabase.from('product_visual_tags').upsert({
              shopify_product_id: product.id,
              product_title: product.title,
              visual_tags: tags,
              analyzed_image_urls: product.imageUrls,
              ai_description: description,
              last_analyzed_at: new Date().toISOString(),
            }, { onConflict: 'shopify_product_id' });

            console.log(`[visual-tags] ✅ ${product.title}: ${tags.join(', ')}`);
            return { product: product.title, tags };
          } catch (err) {
            console.error(`[visual-tags] ❌ ${product.title}:`, err);
            throw err;
          }
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') analyzed++;
        else errors++;
      }

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < productsToAnalyze.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(`[visual-tags] Done: ${analyzed} analyzed, ${errors} errors`);

    return new Response(JSON.stringify({
      success: true,
      total_products: allProducts.length,
      analyzed,
      errors,
      skipped: allProducts.length - productsToAnalyze.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[visual-tags] Fatal error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
