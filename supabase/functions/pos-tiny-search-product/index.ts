import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, query, gtin } = await req.json();
    if (!store_id) throw new Error('store_id is required');
    if (!query && !gtin) throw new Error('query or gtin is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get store token
    const { data: store, error: storeError } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (storeError || !store?.tiny_token) throw new Error('Store not found or token not configured');

    const token = store.tiny_token;

    // Search by GTIN (barcode) or by text query (SKU/name)
    let params = `token=${token}&formato=json`;
    if (gtin) {
      // Search by barcode/GTIN
      params += `&pesquisa=&gtin=${encodeURIComponent(gtin)}`;
    } else {
      params += `&pesquisa=${encodeURIComponent(query)}`;
    }

    const searchResp = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const searchData = await searchResp.json();
    console.log('Tiny search response status:', searchData.retorno?.status);

    if (searchData.retorno?.status === 'Erro') {
      const errorMsg = searchData.retorno?.erros?.[0]?.erro || 'Product not found';
      return new Response(JSON.stringify({ success: false, error: errorMsg, products: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawProducts = searchData.retorno?.produtos || [];
    const products = [];

    // Get full details for each product found (up to 5)
    for (const item of rawProducts.slice(0, 5)) {
      const p = item.produto;
      try {
        const detailResp = await fetch('https://api.tiny.com.br/api2/produto.obter.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${p.id}`,
        });
        const detailData = await detailResp.json();
        const full = detailData.retorno?.produto;

        if (full) {
          // Check for variations
          const variations = full.variacoes || [];
          if (variations.length > 0) {
            for (const v of variations) {
              const variation = v.variacao;
              products.push({
                tiny_id: full.id,
                sku: variation.codigo || full.codigo,
                name: full.nome,
                variant: variation.grade?.tamanho || variation.grade?.cor || variation.variacao || '',
                size: variation.grade?.tamanho || null,
                category: full.classe_produto || null,
                price: parseFloat(variation.preco || full.preco || '0'),
                barcode: variation.gtin || full.gtin || '',
                stock: parseFloat(variation.estoqueAtual || full.estoqueAtual || '0'),
              });
            }
          } else {
            products.push({
              tiny_id: full.id,
              sku: full.codigo || '',
              name: full.nome,
              variant: '',
              size: null,
              category: full.classe_produto || null,
              price: parseFloat(full.preco || '0'),
              barcode: full.gtin || '',
              stock: parseFloat(full.estoqueAtual || '0'),
            });
          }
        }
      } catch (e) {
        console.error('Error getting product detail:', e);
        // Fallback to search data
        products.push({
          tiny_id: p.id,
          sku: p.codigo || '',
          name: p.nome,
          variant: '',
          size: null,
          category: null,
          price: parseFloat(p.preco || '0'),
          barcode: '',
          stock: 0,
        });
      }
    }

    // FASE 2 — Anti-fantasma: persistir no cache local (pos_products) os produtos
    // que vieram da busca ao vivo do Tiny e ainda não existem nesta loja.
    // Só INSERE novos (nunca sobrescreve estoque/dados de produto já cadastrado).
    try {
      for (const prod of products) {
        const sku = (prod.sku || '').trim();
        if (!sku) continue;
        const variant = prod.variant || '';

        const { data: existing } = await supabase
          .from('pos_products')
          .select('id')
          .eq('store_id', store_id)
          .eq('sku', sku)
          .eq('variant', variant)
          .maybeSingle();

        if (existing) continue; // já existe — não mexe (estoque é independente do Tiny)

        // Deriva tamanho/cor a partir do nome quando não vier na grade
        let size = prod.size || null;
        let color: string | null = null;
        const parts = (prod.name || '').split(' - ').map((s: string) => s.trim());
        if (parts.length >= 3) {
          if (!size) size = parts[parts.length - 1] || null;
          color = parts[parts.length - 2] || null;
          // formato comum: "NOME - COR - TAMANHO"
          if (/^\d{1,2}$/.test(parts[parts.length - 1])) {
            if (!size) size = parts[parts.length - 1];
            color = parts[parts.length - 2] || null;
          }
        }

        await supabase.from('pos_products').insert({
          store_id,
          tiny_id: prod.tiny_id || null,
          sku,
          name: prod.name || sku,
          variant,
          size,
          color,
          category: prod.category || null,
          price: prod.price || 0,
          barcode: prod.barcode || '',
          stock: prod.stock || 0, // semente inicial vinda do Tiny; balanço passa a ser fonte da verdade
          is_active: true,
          synced_at: new Date().toISOString(),
        });
        console.log('Fase2 anti-fantasma: produto persistido no cache', { sku, variant, name: prod.name });
      }
    } catch (persistErr) {
      // Nunca quebrar a venda por causa da persistência
      console.error('Fase2 persist error (ignorado):', persistErr);
    }

    return new Response(JSON.stringify({ success: true, products }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, products: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
