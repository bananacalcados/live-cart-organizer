import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Gera um EAN-13 com prefixo 789 (Brasil) e dígito verificador válido. */
function generateEan13(prefix = "789"): string {
  const random = Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0");
  const base = (prefix + random).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(base[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check.toString();
}

function normalizeColorForSku(color: string): string {
  return (color || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 10) || "UN";
}

/** Remove o sufixo " - Cor Tamanho" de um nome de variação, devolvendo o nome do pai. */
function baseNameFromVariant(name: string): string {
  if (!name) return name;
  const idx = name.lastIndexOf(" - ");
  return idx > 0 ? name.slice(0, idx) : name;
}

/**
 * Vincula linhas selecionadas de uma NF-e a um PRODUTO PAI EXISTENTE no PDV
 * (pos_products, identificado por parent_sku) e lança o estoque de entrada.
 *
 * - Replica a variação em TODAS as lojas ativas (bipável + estoque compartilhado p/ Shopify),
 *   mas o estoque de entrada da NF entra APENAS na loja escolhida (store_id).
 * - Se a variação (por GTIN/barcode) já existir, SOMA a quantidade ao estoque atual.
 * - Marca as linhas da NF como vinculadas (linked_parent_sku / linked_store_id / linked_at).
 *
 * Body: { invoice_id, store_id, parent_sku, item_ids: string[] }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { invoice_id, store_id, parent_sku, item_ids, dry_run } = await req.json();

    if (!store_id) throw new Error("store_id é obrigatório (loja que recebe o estoque).");
    if (!parent_sku) throw new Error("parent_sku é obrigatório.");
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      throw new Error("Selecione ao menos uma linha da NF.");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Linhas da NF a vincular
    const { data: items, error: itErr } = await supabase
      .from("purchase_invoice_items")
      .select("id, description, ncm, quantity, unit_cost, ean, parsed_color, parsed_size")
      .in("id", item_ids);
    if (itErr) throw itErr;
    if (!items || items.length === 0) throw new Error("Linhas da NF não encontradas.");

    // ===== PRÉVIA (dry_run): diz quais variações seriam NOVAS vs ATUALIZADAS, sem gravar =====
    if (dry_run) {
      const created: string[] = [];
      const updated: string[] = [];
      for (const it of items) {
        const color = (it.parsed_color || "").toString().trim();
        const size = (it.parsed_size || "").toString().trim();
        const label = `${color} ${size}`.trim().replace(/\s+/g, " ") || "(sem cor/tam)";
        const barcode = (it.ean && /^\d{8,14}$/.test(it.ean)) ? it.ean : null;

        let exists = false;
        if (barcode) {
          const { data } = await supabase
            .from("pos_products").select("id")
            .eq("store_id", store_id).eq("barcode", barcode).maybeSingle();
          exists = !!data;
        }
        if (!exists && color && size) {
          const { data } = await supabase
            .from("pos_products").select("id")
            .eq("store_id", store_id).eq("parent_sku", parent_sku)
            .eq("color", color).eq("size", size).maybeSingle();
          exists = !!data;
        }
        (exists ? updated : created).push(label);
      }
      return new Response(
        JSON.stringify({ success: true, dry_run: true, created, updated }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // Produto pai existente (qualquer linha desse parent_sku serve de modelo)
    const { data: template, error: tplErr } = await supabase
      .from("pos_products")
      .select("name, category, category_id, price, cost_price, image_url, gender, age_group, price_tier_id")
      .eq("parent_sku", parent_sku)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (tplErr) throw tplErr;
    if (!template) throw new Error("Produto pai não encontrado no PDV (parent_sku inválido).");

    const baseName = baseNameFromVariant(template.name || "");

    // Lojas ativas
    const { data: stores } = await supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    const targetStores = (stores || []) as { id: string; name: string }[];
    if (targetStores.length === 0) throw new Error("Nenhuma loja PDV ativa cadastrada.");

    const perStore: Array<{ store_id: string; store_name: string; inserted: number; updated: number; errors: number }> = [];
    let usedSeq = 0;

    for (const store of targetStores) {
      let inserted = 0;
      let updated = 0;
      let errors = 0;
      const isStockStore = store.id === store_id;

      for (const it of items) {
        const color = (it.parsed_color || "").toString().trim();
        const size = (it.parsed_size || "").toString().trim();
        const variant = `${color} ${size}`.trim().replace(/\s+/g, " ");
        const varName = `${baseName} - ${color} ${size}`.trim().replace(/\s+/g, " ");
        const barcode = (it.ean && /^\d{8,14}$/.test(it.ean)) ? it.ean : generateEan13();
        const cost = Number(it.unit_cost) || template.cost_price || 0;
        const entryStock = isStockStore ? (Number(it.quantity) || 0) : 0;

        // Procura variação existente: primeiro por barcode, depois por parent_sku+cor+tamanho
        let existing: { id: string; stock: number } | null = null;
        if (barcode) {
          const { data } = await supabase
            .from("pos_products")
            .select("id, stock")
            .eq("store_id", store.id)
            .eq("barcode", barcode)
            .maybeSingle();
          existing = (data as any) || null;
        }
        if (!existing && color && size) {
          const { data } = await supabase
            .from("pos_products")
            .select("id, stock")
            .eq("store_id", store.id)
            .eq("parent_sku", parent_sku)
            .eq("color", color)
            .eq("size", size)
            .maybeSingle();
          existing = (data as any) || null;
        }

        if (existing) {
          const patch: Record<string, any> = {
            name: varName,
            parent_sku,
            color: color || null,
            size: size || null,
            variant,
            cost_price: cost,
            is_active: true,
          };
          if (isStockStore) patch.stock = (Number(existing.stock) || 0) + entryStock;
          const { error: upErr } = await supabase.from("pos_products").update(patch).eq("id", existing.id);
          if (upErr) { console.error(`[${store.name}] update:`, upErr.message); errors++; } else updated++;
        } else {
          const sku = `${parent_sku}-${normalizeColorForSku(color)}-${size || "U"}-${++usedSeq}`;
          const { error: insErr } = await supabase.from("pos_products").insert({
            store_id: store.id,
            name: varName,
            sku,
            parent_sku,
            barcode,
            color: color || null,
            size: size || null,
            variant,
            category: template.category || null,
            category_id: template.category_id || null,
            gender: template.gender || null,
            age_group: template.age_group || null,
            price_tier_id: template.price_tier_id || null,
            image_url: template.image_url || null,
            cost_price: cost,
            price: template.price || 0,
            stock: entryStock,
            is_active: true,
          });
          if (insErr) { console.error(`[${store.name}] insert:`, insErr.message); errors++; } else inserted++;
        }
      }

      perStore.push({ store_id: store.id, store_name: store.name, inserted, updated, errors });
    }

    // ===== Espelha as variações no CATÁLOGO (products_master + product_variants) =====
    // Assim a variação criada pela NF-e também aparece na tela de cadastro do produto pai.
    let catalogCreated = 0;
    try {
      const { data: master } = await supabase
        .from("products_master")
        .select("id, sku_root, name, cost_price, sale_price")
        .eq("sku_root", parent_sku)
        .maybeSingle();
      if (master) {
        for (const it of items) {
          const color = (it.parsed_color || "").toString().trim();
          const size = (it.parsed_size || "").toString().trim();
          const barcode = (it.ean && /^\d{8,14}$/.test(it.ean)) ? it.ean : null;
          const cost = Number(it.unit_cost) || master.cost_price || 0;

          // Já existe essa variação no catálogo? (por gtin ou cor+tamanho)
          let exists = false;
          if (barcode) {
            const { data } = await supabase
              .from("product_variants").select("id")
              .eq("master_id", master.id).eq("gtin", barcode).maybeSingle();
            exists = !!data;
          }
          if (!exists && color && size) {
            const { data } = await supabase
              .from("product_variants").select("id")
              .eq("master_id", master.id).eq("color", color).eq("size", size).maybeSingle();
            exists = !!data;
          }
          if (exists) continue;

          const vSku = `${parent_sku}-${(color || "UN").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "UN"}-${size || "U"}`;
          const { error: cvErr } = await supabase.from("product_variants").insert({
            master_id: master.id,
            sku: vSku,
            gtin: barcode,
            color: color || null,
            size: size || null,
            cost_price_override: cost || null,
            initial_stock: 0,
            is_active: true,
            last_sync_source: "nfe",
          });
          if (!cvErr) catalogCreated++;
          else console.error("[catalog mirror]", cvErr.message);
        }
      }
    } catch (e) {
      console.error("[catalog mirror] falhou:", e instanceof Error ? e.message : String(e));
    }

    // Marca as linhas como vinculadas
    await supabase
      .from("purchase_invoice_items")
      .update({
        linked_parent_sku: parent_sku,
        linked_store_id: store_id,
        linked_at: new Date().toISOString(),
      })
      .in("id", item_ids);


    const totalInserted = perStore.reduce((s, r) => s + r.inserted, 0);
    const totalUpdated = perStore.reduce((s, r) => s + r.updated, 0);
    const storeName = targetStores.find((s) => s.id === store_id)?.name || "loja";

    return new Response(
      JSON.stringify({
        success: true,
        message: `${items.length} linha(s) vinculada(s) ao pai ${parent_sku}. Estoque lançado em ${storeName} (${totalInserted} novas variações, ${totalUpdated} atualizadas).`,
        stores: perStore,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[nfe-link-items-pos]", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
