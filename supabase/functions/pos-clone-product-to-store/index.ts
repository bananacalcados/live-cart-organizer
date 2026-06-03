import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Clona um produto PAI + todas as variações (cor/tamanho) de uma loja de origem
 * para a loja de destino, com estoque ZERADO.
 *
 * Mantém o MESMO sku/barcode/gtin (estoque compartilhado por GTIN).
 *
 * Modos:
 *  - { barcode | sku, target_store_id }  → resolve o produto, retorna o grupo
 *    (preview) quando preview=true, ou clona quando commit (default).
 *
 * Resposta:
 *  - found: existe em alguma loja?
 *  - source_store_id / source_store_name
 *  - parent_sku, parent_name
 *  - variants: [{ sku, barcode, color, size, variant }]
 *  - cloned: número de variações criadas na loja destino (quando commit)
 *  - scanned_variant: variação correspondente ao código bipado, já na loja destino
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const targetStoreId: string | undefined = body.target_store_id;
    const rawCode: string = String(body.barcode || body.sku || '').trim();
    const preview: boolean = body.preview === true;

    if (!targetStoreId) throw new Error('target_store_id é obrigatório');
    if (!rawCode) throw new Error('barcode ou sku é obrigatório');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1) Encontra o produto bipado em QUALQUER loja (exceto a destino, mas
    //    aceitamos qualquer uma — a destino só não terá esse código ainda).
    const { data: matches, error: matchErr } = await supabase
      .from('pos_products')
      .select('id, store_id, parent_sku, sku, barcode, name, variant, color, size, category, category_id, price, cost_price, image_url, gender, age_group, price_tier_id')
      .or(`barcode.eq.${rawCode},sku.eq.${rawCode}`)
      .neq('store_id', targetStoreId)
      .limit(50);

    if (matchErr) throw matchErr;

    if (!matches || matches.length === 0) {
      return new Response(JSON.stringify({ success: true, found: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prioriza o match exato pelo barcode
    const source = matches.find((m) => m.barcode === rawCode) || matches[0];
    const sourceStoreId = source.store_id as string;
    const parentSku = source.parent_sku as string | null;

    // Nome da loja de origem
    const { data: srcStore } = await supabase
      .from('pos_stores')
      .select('name')
      .eq('id', sourceStoreId)
      .maybeSingle();

    // 2) Busca o grupo completo (pai + filhos) na loja de origem por parent_sku.
    let groupRows: any[] = [];
    if (parentSku) {
      const { data: grp } = await supabase
        .from('pos_products')
        .select('parent_sku, sku, barcode, name, variant, color, size, category, category_id, price, cost_price, image_url, gender, age_group, price_tier_id')
        .eq('store_id', sourceStoreId)
        .eq('parent_sku', parentSku);
      groupRows = grp || [];
    }
    // Garante que pelo menos o item bipado esteja no grupo
    if (groupRows.length === 0) {
      groupRows = [source];
    }

    const variantsPreview = groupRows.map((r) => ({
      sku: r.sku,
      barcode: r.barcode,
      color: r.color,
      size: r.size,
      variant: r.variant,
      name: r.name,
    }));

    if (preview) {
      return new Response(JSON.stringify({
        success: true,
        found: true,
        source_store_id: sourceStoreId,
        source_store_name: srcStore?.name || null,
        parent_sku: parentSku,
        parent_name: source.name,
        variant_count: groupRows.length,
        variants: variantsPreview,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3) Clona o grupo para a loja destino, com stock=0, pulando os que já existem.
    const { data: existing } = await supabase
      .from('pos_products')
      .select('sku, barcode')
      .eq('store_id', targetStoreId)
      .or(
        groupRows
          .map((r) => (r.sku ? `sku.eq.${r.sku}` : null))
          .filter(Boolean)
          .join(',') || 'sku.eq.__none__',
      );

    const existingSkus = new Set((existing || []).map((e) => e.sku).filter(Boolean));

    const toInsert = groupRows
      .filter((r) => !(r.sku && existingSkus.has(r.sku)))
      .map((r) => ({
        store_id: targetStoreId,
        tiny_id: null,
        parent_sku: r.parent_sku ?? parentSku ?? null,
        sku: r.sku,
        barcode: r.barcode,
        name: r.name,
        variant: r.variant,
        color: r.color,
        size: r.size,
        category: r.category,
        category_id: r.category_id,
        price: r.price ?? 0,
        cost_price: r.cost_price ?? null,
        image_url: r.image_url ?? null,
        gender: r.gender ?? null,
        age_group: r.age_group ?? null,
        price_tier_id: r.price_tier_id ?? null,
        stock: 0,
        is_active: false,
        synced_at: new Date().toISOString(),
      }));

    let cloned = 0;
    if (toInsert.length > 0) {
      const { error: insErr, count } = await supabase
        .from('pos_products')
        .insert(toInsert, { count: 'exact' });
      if (insErr) throw new Error('Falha ao clonar variações: ' + insErr.message);
      cloned = count ?? toInsert.length;
    }

    // 4) Retorna a variação correspondente ao código bipado já na loja destino.
    const { data: scannedVariant } = await supabase
      .from('pos_products')
      .select('id, tiny_id, sku, barcode, name, variant, color, size')
      .eq('store_id', targetStoreId)
      .or(`barcode.eq.${rawCode},sku.eq.${rawCode}`)
      .limit(1)
      .maybeSingle();

    return new Response(JSON.stringify({
      success: true,
      found: true,
      source_store_id: sourceStoreId,
      source_store_name: srcStore?.name || null,
      parent_sku: parentSku,
      parent_name: source.name,
      variant_count: groupRows.length,
      cloned,
      scanned_variant: scannedVariant || null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[pos-clone-product-to-store] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
