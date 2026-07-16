import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Empurra VARIAÇÕES NOVAS de um produto pai já existente para o PDV (pos_products).
 *
 * - Replica cada variação em TODAS as lojas ativas (bipável + estoque compartilhado p/ Shopify).
 * - O estoque inicial entra APENAS na loja escolhida (store_id); nas demais fica ZERADO.
 * - É idempotente por (store_id, barcode): se a variação já existir naquela loja,
 *   apenas atualiza os dados cadastrais e NÃO mexe no estoque (evita somar em dobro).
 *
 * Body: { master_id, store_id, variant_ids: string[] }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { master_id, store_id, variant_ids } = await req.json();
    if (!master_id) throw new Error("master_id é obrigatório.");
    if (!store_id) throw new Error("store_id é obrigatório (loja que recebe o estoque).");
    if (!Array.isArray(variant_ids) || variant_ids.length === 0) {
      throw new Error("Nenhuma variação nova para enviar.");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: master, error: mErr } = await supabase
      .from("products_master")
      .select("*")
      .eq("id", master_id)
      .single();
    if (mErr) throw mErr;
    if (!master) throw new Error("Produto pai não encontrado.");

    const parentSku = master.sku_root || `PMSTR-${master.id}`;

    const { data: variants, error: vErr } = await supabase
      .from("product_variants")
      .select("id, sku, gtin, color, size, cost_price_override, sale_price_override, initial_stock")
      .eq("master_id", master_id)
      .in("id", variant_ids);
    if (vErr) throw vErr;
    if (!variants || variants.length === 0) throw new Error("Variações não encontradas.");

    const { data: stores } = await supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_simulation", false)
      .order("name");
    const targetStores = (stores || []) as { id: string; name: string }[];
    if (targetStores.length === 0) throw new Error("Nenhuma loja PDV ativa cadastrada.");

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    for (const store of targetStores) {
      const isStockStore = store.id === store_id;
      for (const v of variants) {
        const vColor = (v.color || "").toString().trim();
        const vSize = (v.size || "").toString().trim();
        const vVariant = `${vColor} ${vSize}`.trim().replace(/\s+/g, " ");
        const skuName = `${master.name} - ${vColor} ${vSize}`.trim().replace(/\s+/g, " ");
        const cost = v.cost_price_override ?? master.cost_price ?? 0;
        const sale = v.sale_price_override ?? master.sale_price ?? 0;
        const entryStock = isStockStore ? (Number(v.initial_stock) || 0) : 0;

        // Idempotência por (loja, barcode): se já existe, NÃO mexe no estoque.
        const { data: existing } = await supabase
          .from("pos_products")
          .select("id")
          .eq("store_id", store.id)
          .eq("barcode", v.gtin)
          .maybeSingle();

        if (existing) {
          const { error: upErr } = await supabase
            .from("pos_products")
            .update({
              name: skuName,
              sku: v.sku,
              parent_sku: parentSku,
              color: vColor || null,
              size: vSize || null,
              variant: vVariant,
              cost_price: cost,
              price: sale,
              is_active: true,
            })
            .eq("id", existing.id);
          if (upErr) { console.error(`[${store.name}] update:`, upErr.message); totalErrors++; }
          else totalUpdated++;
        } else {
          const { error: insErr } = await supabase.from("pos_products").insert({
            store_id: store.id,
            name: skuName,
            sku: v.sku,
            parent_sku: parentSku,
            barcode: v.gtin,
            color: vColor || null,
            size: vSize || null,
            variant: vVariant,
            cost_price: cost,
            price: sale,
            stock: entryStock,
            is_active: true,
          });
          if (insErr) { console.error(`[${store.name}] insert:`, insErr.message); totalErrors++; }
          else totalInserted++;
        }
      }
    }

    const storeName = targetStores.find((s) => s.id === store_id)?.name || "loja";
    return new Response(
      JSON.stringify({
        success: true,
        message: `${variants.length} variação(ões) enviada(s) ao PDV (${totalInserted} novas, ${totalUpdated} atualizadas). Estoque lançado em ${storeName}.`,
        inserted: totalInserted,
        updated: totalUpdated,
        errors: totalErrors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pos-add-variants]", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
