import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { master_id, store_id, all_stores, stock_from_variants } = await req.json();
    if (!master_id) {
      return new Response(JSON.stringify({ error: "master_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: master } = await supabase
      .from("products_master")
      .select("*")
      .eq("id", master_id)
      .single();

    const { data: variants } = await supabase
      .from("product_variants")
      .select("*")
      .eq("master_id", master_id);

    if (!master || !variants?.length) {
      return new Response(JSON.stringify({ error: "Produto/variações não encontrados" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === A2: espelhar catálogo em product_master_data (parent_sku = sku_root) ===
    const parentSku = master.sku_root || `PMSTR-${master.id}`;
    const reasons: string[] = [];
    if (!master.ncm || String(master.ncm).length < 8) reasons.push("NCM ausente/inválido");
    if (!master.cost_price || Number(master.cost_price) <= 0) reasons.push("Custo ausente");
    if (!master.sale_price || Number(master.sale_price) <= 0) reasons.push("Preço de venda ausente");

    await supabase.from("product_master_data").upsert({
      parent_sku: parentSku,
      name: master.name,
      description: master.description,
      brand: master.brand,
      category: master.category,
      classe_produto: master.classe_produto,
      ncm: master.ncm,
      cest: master.cest,
      cfop: master.cfop || null,
      origem: master.origem,
      unidade: master.unidade || "PC",
      cost_price: master.cost_price,
      sale_price: master.sale_price,
      weight_kg: master.weight_kg,
      height_cm: master.height_cm,
      width_cm: master.width_cm,
      length_cm: master.length_cm,
      images: master.images || [],
      shopify_product_id: master.shopify_product_id,
      tiny_product_id: master.tiny_product_id,
      is_active: true,
      needs_review: reasons.length > 0,
      review_reason: reasons.length > 0 ? reasons.join("; ") : null,
    }, { onConflict: "parent_sku" });

    // Resolve target stores: default = ALL active stores (PDV needs product everywhere)
    let targetStoreIds: string[] = [];
    if (store_id) {
      targetStoreIds = [store_id];
    } else {
      const { data: stores } = await supabase
        .from("pos_stores")
        .select("id")
        .order("name");
      targetStoreIds = (stores || []).map((s: any) => s.id);
    }

    if (targetStoreIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhuma loja PDV cadastrada" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const perStoreResults: Array<{ store_id: string; store_name: string; inserted: number; updated: number; errors: number }> = [];
    let totalInserted = 0;

    for (const targetStoreId of targetStoreIds) {
      const { data: store } = await supabase
        .from("pos_stores")
        .select("id, name")
        .eq("id", targetStoreId)
        .single();

      let inserted = 0;
      let updated = 0;
      let errors = 0;

      for (const v of variants) {
        const cost = v.cost_price_override ?? master.cost_price;
        const sale = v.sale_price_override ?? master.sale_price;
        const skuName = `${master.name} - ${v.color || ''} ${v.size || ''}`.trim().replace(/\s+/g, ' ');
        // Estoque de entrada (vindo da NF-e): só entra na loja escolhida.
        const entryStock = stock_from_variants ? (Number(v.initial_stock) || 0) : 0;

        // Lookup existing by barcode in this store
        const { data: existing } = await supabase
          .from("pos_products")
          .select("id, stock")
          .eq("store_id", targetStoreId)
          .eq("barcode", v.gtin)
          .maybeSingle();

        if (existing) {
          const updatePayload: Record<string, any> = {
            name: skuName,
            sku: v.sku,
            parent_sku: parentSku,
            cost_price: cost,
            price: sale,
            is_active: true,
          };
          // NF-e adiciona ao estoque existente da loja
          if (stock_from_variants) {
            updatePayload.stock = (Number(existing.stock) || 0) + entryStock;
          }
          const { error: upErr } = await supabase
            .from("pos_products")
            .update(updatePayload)
            .eq("id", existing.id);
          if (upErr) {
            console.error(`[${store?.name}] update error:`, upErr);
            errors++;
          } else {
            updated++;
          }
        } else {
          const { error: insErr } = await supabase
            .from("pos_products")
            .insert({
              store_id: targetStoreId,
              name: skuName,
              sku: v.sku,
              parent_sku: parentSku,
              barcode: v.gtin,
              cost_price: cost,
              price: sale,
              stock: entryStock, // NF-e: estoque inicial; demais fluxos: 0
              is_active: true,
            });
          if (insErr) {
            console.error(`[${store?.name}] insert error:`, insErr);
            errors++;
          } else {
            inserted++;
            totalInserted++;
          }
        }
      }

      perStoreResults.push({
        store_id: targetStoreId,
        store_name: store?.name || targetStoreId,
        inserted,
        updated,
        errors,
      });
    }

    // Marca o master como enviado (mantém marker antigo por compatibilidade)
    await supabase
      .from("products_master")
      .update({ tiny_product_id: `pdv-all-${targetStoreIds.length}` })
      .eq("id", master_id);

    const totalUpdated = perStoreResults.reduce((s, r) => s + r.updated, 0);
    const totalVariants = variants.length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `${totalVariants} variações sincronizadas em ${perStoreResults.length} loja(s) (${totalInserted} novas, ${totalUpdated} atualizadas)`,
        stores: perStoreResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
