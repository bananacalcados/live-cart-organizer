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
    const { master_id, store_id } = await req.json();
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

    // Resolve store
    let targetStoreId = store_id;
    if (!targetStoreId) {
      const { data: stores } = await supabase
        .from("pos_stores")
        .select("id, tiny_token")
        .not("tiny_token", "is", null)
        .limit(1);
      targetStoreId = stores?.[0]?.id;
    }
    if (!targetStoreId) {
      return new Response(JSON.stringify({ error: "Nenhuma loja com Tiny configurado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: store } = await supabase
      .from("pos_stores")
      .select("tiny_token, name")
      .eq("id", targetStoreId)
      .single();

    const tinyToken = store?.tiny_token || Deno.env.get("TINY_ERP_TOKEN");
    if (!tinyToken) {
      return new Response(JSON.stringify({ error: "Token Tiny não disponível" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cria produtos no PDV (pos_products) — um por variante
    const insertedIds: string[] = [];
    for (const v of variants) {
      const cost = v.cost_price_override ?? master.cost_price;
      const sale = v.sale_price_override ?? master.sale_price;
      const skuName = `${master.name} - ${v.color} ${v.size}`;

      const { data: existing } = await supabase
        .from("pos_products")
        .select("id")
        .eq("store_id", targetStoreId)
        .eq("barcode", v.gtin)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("pos_products")
          .update({
            name: skuName,
            sku: v.sku,
            cost_price: cost,
            price: sale,
            stock: v.initial_stock || 0,
            is_active: true,
          })
          .eq("id", existing.id);
        insertedIds.push(existing.id);
      } else {
        const { data: newP, error: insErr } = await supabase
          .from("pos_products")
          .insert({
            store_id: targetStoreId,
            name: skuName,
            sku: v.sku,
            barcode: v.gtin,
            cost_price: cost,
            price: sale,
            stock: v.initial_stock || 0,
            is_active: true,
          })
          .select("id")
          .single();
        if (insErr) {
          console.error("Insert pos_products error:", insErr);
          continue;
        }
        if (newP) insertedIds.push(newP.id);
      }
    }

    // Marca o master como enviado
    await supabase
      .from("products_master")
      .update({ tiny_product_id: `pdv-${targetStoreId}` })
      .eq("id", master_id);

    return new Response(
      JSON.stringify({
        success: true,
        message: `${insertedIds.length} variações enviadas para ${store?.name}`,
        store_id: targetStoreId,
        product_ids: insertedIds,
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
