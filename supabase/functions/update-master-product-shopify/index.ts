// Shopify data updates preserve all media and linked taxonomy options.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.25.76";
import { planVariants, productData, resolveOptionInputs } from "./safe-update.ts";

const Body = z.object({ master_id: z.string().uuid(), dry_run: z.boolean().optional() });
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Método não permitido" }, 405);
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return reply({ error: "Informe um produto válido" }, 400);
    const { master_id, dry_run } = parsed.data;
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !serviceKey || !anonKey) throw new Error("Configuração indisponível");
    const sb = createClient(url, serviceKey);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Entre novamente para atualizar o produto" }, 401);
    let reader = sb;
    if (token !== serviceKey) {
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data.user) return reply({ error: "Sessão inválida" }, 401);
      reader = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    }
    // Read with the caller's existing inventory policies, not a client-provided role.
    const { data: master, error: masterError } = await reader.from("products_master")
      .select("id,name,description,brand,category,is_active,shopify_product_id,sale_price,weight_kg")
      .eq("id", master_id).maybeSingle();
    if (masterError || !master) return reply({ error: "Produto não encontrado ou sem acesso" }, 403);
    if (!master.shopify_product_id) return reply({ error: "Produto sem vínculo Shopify. Use Criar na Shopify." }, 409);
    const { data: rows, error: rowsError } = await reader.from("product_variants")
      .select("id,master_id,color,size,sku,gtin,shopify_variant_id,sale_price_override,weight_kg_override,initial_stock")
      .eq("master_id", master_id).order("id").limit(201);
    if (rowsError) throw rowsError;
    if (!rows?.length || rows.length > 200) return reply({ error: "Produto sem variações ou acima do limite de 200; precisa de conferência." }, 409);
    const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
    const shopToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!domain || !shopToken) throw new Error("Credenciais Shopify não configuradas");
    const gql = async (query: string, variables: Record<string, unknown> = {}) => {
      const res = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopToken },
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json();
      if (!res.ok || json.errors?.length) throw new Error(`Shopify: ${json.errors?.map((e: any) => e.message).join("; ") || res.status}`);
      return json.data;
    };
    const productId = `gid://shopify/Product/${master.shopify_product_id}`;
    const productQuery = `query($id:ID!,$after:String){product(id:$id){id title options{id name linkedMetafield{namespace key} optionValues{id name linkedMetafieldValue}} variants(first:100,after:$after){nodes{id barcode inventoryItem{sku} selectedOptions{name value}} pageInfo{hasNextPage endCursor}}}}`;
    const first = await gql(productQuery, { id: productId });
    const product = first.product;
    if (!product) return reply({ error: "Produto não existe mais na Shopify. Nenhum vínculo foi apagado." }, 404);
    // Bounded pagination of this product only; never scan the catalog.
    while (product.variants.pageInfo.hasNextPage) {
      if (product.variants.nodes.length >= 200) return reply({ error: "Anúncio acima do limite de 200 variações; nada foi atualizado." }, 409);
      const next = await gql(productQuery, { id: productId, after: product.variants.pageInfo.endCursor });
      if (!next.product) throw new Error("Produto indisponível durante a conferência");
      product.variants.nodes.push(...next.product.variants.nodes);
      product.variants.pageInfo = next.product.variants.pageInfo;
    }
    const variants = rows.map((row: any) => ({ ...row,
      sale_price_override: row.sale_price_override ?? master.sale_price ?? 0,
      weight_kg_override: row.weight_kg_override ?? master.weight_kg ?? 0,
    }));
    const colors: any[] = [];
    // Fetch only the bounded color dictionary, only if a new linked value is needed.
    const needsColors = product.options.some((option: any) => option.linkedMetafield && variants.some((v: any) =>
      !v.shopify_variant_id && !option.optionValues.some((ov: any) => ov.name.trim().toLowerCase() === String(v.color || "").trim().toLowerCase()),
    ));
    if (needsColors) {
      const dictionary = await gql(`query{metaobjects(type:"shopify--color-pattern",first:100){nodes{id displayName} pageInfo{hasNextPage}}}`);
      if (dictionary.metaobjects.pageInfo.hasNextPage) throw new Error("Catálogo de padrões acima de 100 cores: confira o vínculo da cor na Shopify. Nada foi atualizado.");
      colors.push(...dictionary.metaobjects.nodes);
    }
    const plan = planVariants(variants, product, colors);
    const newGtins = [...new Set(plan.create.map((item) => item.owner.gtin).filter(Boolean))];
    const stockByGtin = new Map<string, number>();
    if (newGtins.length) {
      const { data: stock, error } = await sb.from("pos_products").select("barcode,stock").in("barcode", newGtins);
      if (error) throw error;
      for (const row of stock || []) stockByGtin.set(String(row.barcode), (stockByGtin.get(String(row.barcode)) || 0) + Number(row.stock || 0));
    }
    let locationId: string | undefined;
    if (plan.create.length) {
      const locations = await gql(`query{locations(first:10){nodes{id isActive}}}`);
      locationId = locations.locations.nodes.find((location: any) => location.isActive)?.id;
      if (!locationId) throw new Error("Nenhum local ativo na Shopify; nada foi atualizado.");
    }
    if (dry_run) return reply({ success: true, dry_run: true, variants_to_create: plan.create.length,
      variants_to_update: plan.update.length, colors_to_add: plan.additions.length, photos_preserved: true });
    const errors: string[] = [];
    const checkMutation = (result: any) => {
      if (!result || result.userErrors?.length) throw new Error(result?.userErrors?.map((e: any) => e.message).join("; ") || "Shopify não confirmou a atualização");
      return result;
    };
    for (const addition of plan.additions) {
      const data = await gql(`mutation($pid:ID!,$oid:ID!,$gid:String!){productOptionUpdate(productId:$pid,option:{id:$oid},optionValuesToAdd:[{linkedMetafieldValue:$gid}],variantStrategy:LEAVE_AS_IS){product{options{id name optionValues{id name linkedMetafieldValue}}} userErrors{message}}}`,
        { pid: productId, oid: addition.optionId, gid: addition.gid });
      const result = checkMutation(data.productOptionUpdate);
      product.options = result.product.options;
    }
    const links: any[] = [...plan.links];
    let created = 0;
    // Initial quantities are set in the creation request, not a separate per-item loop.
    for (let offset = 0; offset < plan.create.length; offset += 50) {
      const chunk = plan.create.slice(offset, offset + 50);
      const inputs = chunk.map(({ owner, input }) => ({ ...input,
        optionValues: resolveOptionInputs(input.optionValues, product.options),
        inventoryQuantities: [{ locationId, availableQuantity: stockByGtin.get(String(owner.gtin)) ?? Number(owner.initial_stock || 0) }],
      }));
      const data = await gql(`mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$pid,variants:$v){productVariants{id barcode inventoryItem{sku} selectedOptions{name value}} userErrors{message}}}`, { pid: productId, v: inputs });
      const result = data.productVariantsBulkCreate;
      // Match by selected options, never by array position or price.
      for (const pv of result?.productVariants || []) {
        const owner = chunk.find(({ input }) => input.optionValues.every((ov: any) =>
          pv.selectedOptions.some((so: any) => so.name === ov.optionName && so.value === ov.name)))?.owner;
        if (!owner) { errors.push("Variação criada sem vínculo local confirmado; confira o anúncio antes de repetir."); continue; }
        links.push({ variant_id: owner.id, shopify_variant_id: pv.id.split("/").pop() });
        created++;
      }
      if (result?.userErrors?.length) errors.push(...result.userErrors.map((e: any) => e.message));
      if (!result) errors.push("Criação não confirmada pela Shopify");
    }
    if (links.length) {
      const { error } = await sb.rpc("apply_shopify_links", { _links: links.map((link) => ({ ...link, master_id, shopify_product_id: String(master.shopify_product_id) })) });
      if (error) throw new Error("Variações existem na Shopify, mas o vínculo local não foi salvo; confira antes de repetir.");
    }
    let updated = 0;
    if (!errors.length) {
      for (let offset = 0; offset < plan.update.length; offset += 50) {
        const data = await gql(`mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$pid,variants:$v){productVariants{id} userErrors{message}}}`, { pid: productId, v: plan.update.slice(offset, offset + 50) });
        const result = checkMutation(data.productVariantsBulkUpdate);
        updated += result.productVariants.length;
      }
      const data = await gql(`mutation($p:ProductUpdateInput!){productUpdate(product:$p){product{id} userErrors{message}}}`, { p: { id: productId, ...productData(master) } });
      checkMutation(data.productUpdate);
    }
    const message = errors.length ? `Atualização incompleta: ${created} novas variações criadas. ${errors.join("; ")}` :
      `Produto atualizado: ${updated} variações atualizadas, ${created} novas criadas. Fotos e vínculos de cor preservados.`;
    return reply({ success: !errors.length, message, error: errors.length ? message : undefined,
      variants_created: created, variants_updated: updated, photos_preserved: true, create_errors: errors }, errors.length ? 409 : 200);
  } catch (error) {
    console.error("Atualização Shopify:", error instanceof Error ? error.message : "Erro inesperado");
    return reply({ error: error instanceof Error ? error.message : "Não foi possível atualizar o produto" }, 409);
  }
});
