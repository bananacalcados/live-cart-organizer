import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { source_product_id, dest_store_id, quantity, reason } =
      await req.json();

    const qty = Number(quantity);
    if (!source_product_id || !dest_store_id) {
      throw new Error("source_product_id e dest_store_id são obrigatórios");
    }
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      throw new Error("Quantidade inválida (use inteiro > 0)");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Origem
    const { data: source, error: srcErr } = await supabase
      .from("pos_products")
      .select("*")
      .eq("id", source_product_id)
      .single();
    if (srcErr || !source) throw new Error("Produto de origem não encontrado");

    if (source.store_id === dest_store_id) {
      throw new Error("Loja de destino deve ser diferente da origem");
    }

    const sourceStock = Number(source.stock || 0);
    if (sourceStock < qty) {
      throw new Error(
        `Estoque insuficiente na origem (disponível: ${sourceStock})`,
      );
    }

    // 2) Validar lojas reais (nunca simulação)
    const { data: stores } = await supabase
      .from("pos_stores")
      .select("id, name, is_active, is_simulation")
      .in("id", [source.store_id, dest_store_id]);

    const srcStore = stores?.find((s) => s.id === source.store_id);
    const destStore = stores?.find((s) => s.id === dest_store_id);
    if (!srcStore || !destStore) throw new Error("Loja não encontrada");
    if (srcStore.is_simulation || destStore.is_simulation) {
      throw new Error(
        "Transferência não permitida envolvendo loja de simulação",
      );
    }
    if (!destStore.is_active) {
      throw new Error("Loja de destino está inativa");
    }

    // 3) Localizar destino: barcode → parent_sku+color+size → sku
    let dest: any = null;
    if (source.barcode) {
      const { data } = await supabase
        .from("pos_products")
        .select("*")
        .eq("store_id", dest_store_id)
        .eq("barcode", source.barcode)
        .maybeSingle();
      if (data) dest = data;
    }
    if (!dest && source.parent_sku) {
      const { data } = await supabase
        .from("pos_products")
        .select("*")
        .eq("store_id", dest_store_id)
        .eq("parent_sku", source.parent_sku)
        .eq("color", source.color || "")
        .eq("size", source.size || "")
        .maybeSingle();
      if (data) dest = data;
    }
    if (!dest && source.sku) {
      const { data } = await supabase
        .from("pos_products")
        .select("*")
        .eq("store_id", dest_store_id)
        .eq("sku", source.sku)
        .maybeSingle();
      if (data) dest = data;
    }

    let destCreated = false;

    // 4) Se não existe destino, cria copiando cadastro
    if (!dest) {
      const insertPayload: Record<string, any> = {
        store_id: dest_store_id,
        parent_sku: source.parent_sku,
        name: source.name,
        sku: source.sku,
        barcode: source.barcode,
        color: source.color,
        size: source.size,
        variant: source.variant,
        price: source.price,
        cost_price: source.cost_price,
        image_url: source.image_url,
        category: source.category,
        category_id: source.category_id,
        brand: source.brand,
        gender: source.gender,
        age_group: source.age_group,
        price_tier_id: source.price_tier_id,
        stock: qty,
        is_active: true,
      };
      const { data: created, error: insErr } = await supabase
        .from("pos_products")
        .insert(insertPayload)
        .select("*")
        .single();
      if (insErr) {
        throw new Error(
          `Falha ao criar cadastro no destino: ${insErr.message}. Revise SKU/barcode dessa variação no destino.`,
        );
      }
      dest = created;
      destCreated = true;
    }

    const destStockBefore = Number(dest.stock || 0);
    const srcStockAfter = sourceStock - qty;
    const destStockAfter = destCreated ? qty : destStockBefore + qty;

    // 5) UPDATE origem
    const { error: updSrcErr } = await supabase
      .from("pos_products")
      .update({ stock: srcStockAfter })
      .eq("id", source.id);
    if (updSrcErr) throw new Error(`Erro origem: ${updSrcErr.message}`);

    // 6) UPDATE destino (se já existia — se foi criado, já entra com qty)
    if (!destCreated) {
      const { error: updDstErr } = await supabase
        .from("pos_products")
        .update({ stock: destStockAfter })
        .eq("id", dest.id);
      if (updDstErr) {
        // rollback origem
        await supabase
          .from("pos_products")
          .update({ stock: sourceStock })
          .eq("id", source.id);
        throw new Error(`Erro destino: ${updDstErr.message}`);
      }
    }

    // 7) Registrar ajustes
    const transferReason = reason?.trim() || "Transferência entre lojas";
    const fullReason = `${transferReason} (${srcStore.name} → ${destStore.name})`;
    await supabase.from("pos_stock_adjustments").insert([
      {
        store_id: source.store_id,
        product_id: source.id,
        sku: source.sku,
        barcode: source.barcode,
        product_name: source.name,
        direction: "out",
        quantity: qty,
        previous_stock: sourceStock,
        new_stock: srcStockAfter,
        reason: fullReason,
      },
      {
        store_id: dest_store_id,
        product_id: dest.id,
        sku: dest.sku,
        barcode: dest.barcode,
        product_name: dest.name,
        direction: "in",
        quantity: qty,
        previous_stock: destStockBefore,
        new_stock: destStockAfter,
        reason: fullReason,
      },
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        source: {
          store_id: source.store_id,
          store_name: srcStore.name,
          product_id: source.id,
          new_stock: srcStockAfter,
        },
        dest: {
          store_id: dest_store_id,
          store_name: destStore.name,
          product_id: dest.id,
          new_stock: destStockAfter,
          created: destCreated,
          product: destCreated ? dest : null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pos-stock-transfer]", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
