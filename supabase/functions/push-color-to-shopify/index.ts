import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.25.76";
import {
  buildPushPlan,
  matchCreatedVariant,
  normalizePushValue,
  numericShopifyId,
  resolvePushOptionInputs,
} from "./plan.ts";

const Body = z.object({ code: z.string().trim().min(1).max(30), dry_run: z.boolean() });
const PUBLICATION = "gid://shopify/Publication/195361112121";
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const pickOption = (variant: any, expression: RegExp) => variant.selectedOptions?.find((option: any) =>
  expression.test(normalizePushValue(option.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
)?.value ?? null;

Deno.serve(withAccessLog("push-color-to-shopify", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Método não permitido" }, 405);
  const denied = await requireStaffOrInternal(req, ["inventory"], false);
  if (denied) return denied;

  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return reply({ error: "Informe code e dry_run válidos" }, 400);
    const { code, dry_run } = parsed.data;
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
    const shopToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!url || !serviceKey) throw new Error("Configuração do banco indisponível");
    if (!domain || !shopToken) throw new Error("Credenciais Shopify não configuradas");
    const db = createClient(url, serviceKey);

    const { data: colorRow, error: colorError } = await db.from("v_product_color_codes")
      .select("code,master_id,color,sale_price,shopify_product_id")
      .eq("code", code).maybeSingle();
    if (colorError) throw colorError;
    if (!colorRow) return reply({ error: "Código não encontrado" }, 404);
    if (!colorRow.shopify_product_id) return reply({ error: "produto não está na Shopify" }, 409);

    const [{ data: master, error: masterError }, { data: localRows, error: localError }] = await Promise.all([
      db.from("products_master").select("id,name,sale_price").eq("id", colorRow.master_id).single(),
      db.from("product_variants")
        .select("id,master_id,color,size,sku,gtin,shopify_variant_id,is_active")
        .eq("master_id", colorRow.master_id).eq("is_active", true).order("id").limit(201),
    ]);
    if (masterError) throw masterError;
    if (localError) throw localError;
    if (!localRows?.length || localRows.length > 200) return reply({ error: "Produto sem variações ou acima do limite de 200" }, 409);
    const sameColor = localRows.filter((variant: any) =>
      normalizePushValue(variant.color) === normalizePushValue(colorRow.color));
    if (!sameColor.length) return reply({ error: "Nenhuma variação ativa dessa cor no ERP" }, 409);

    const linkedIds = sameColor.map((variant: any) => variant.shopify_variant_id).filter(Boolean);
    const { data: mirrored, error: mirrorReadError } = linkedIds.length
      ? await db.from("shopify_variant_mirror").select("shopify_variant_id").in("shopify_variant_id", linkedIds)
      : { data: [], error: null };
    if (mirrorReadError) throw mirrorReadError;
    const mirroredIds = new Set((mirrored || []).map((row: any) => row.shopify_variant_id));
    const candidates = sameColor.filter((variant: any) =>
      !variant.shopify_variant_id || !mirroredIds.has(variant.shopify_variant_id));

    const productGid = `gid://shopify/Product/${colorRow.shopify_product_id}`;
    const gqlRead = async (query: string, variables: Record<string, unknown> = {}) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopToken },
          body: JSON.stringify({ query, variables }),
        });
        const json = await response.json().catch(() => ({}));
        const throttled = response.status === 429 || (json.errors || []).some((error: any) => error?.extensions?.code === "THROTTLED");
        if (throttled) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        if (!response.ok || json.errors?.length) {
          throw new Error(`Shopify: ${json.errors?.map((error: any) => error.message).join("; ") || response.status}`);
        }
        return json.data;
      }
      throw new Error("Shopify: limite de requisições durante a leitura");
    };
    // Escrita sem repetição automática: uma resposta incerta nunca pode duplicar variações.
    const gqlMutation = async (query: string, variables: Record<string, unknown>) => {
      const response = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopToken },
        body: JSON.stringify({ query, variables }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.errors?.length) {
        throw new Error(`Shopify: ${json.errors?.map((error: any) => error.message).join("; ") || response.status}. Confira o anúncio antes de tentar novamente.`);
      }
      return json.data;
    };

    const productQuery = `query($id:ID!,$after:String,$pub:ID!){product(id:$id){id title status publishedOnPublication(publicationId:$pub) featuredMedia{preview{image{url}}} options{id name linkedMetafield{namespace key} optionValues{id name linkedMetafieldValue}} variants(first:100,after:$after){nodes{id title barcode price selectedOptions{name value} image{url} inventoryItem{sku}} pageInfo{hasNextPage endCursor}}}}`;
    const first = await gqlRead(productQuery, { id: productGid, pub: PUBLICATION });
    const product = first.product;
    if (!product) return reply({ error: "Produto não existe mais na Shopify. Nenhum vínculo foi apagado." }, 404);
    while (product.variants.pageInfo.hasNextPage) {
      if (product.variants.nodes.length >= 200) return reply({ error: "Anúncio acima de 200 variações; precisa de conferência" }, 409);
      const next = await gqlRead(productQuery, { id: productGid, after: product.variants.pageInfo.endCursor, pub: PUBLICATION });
      if (!next.product) throw new Error("Produto indisponível durante a conferência");
      product.variants.nodes.push(...next.product.variants.nodes);
      product.variants.pageInfo = next.product.variants.pageInfo;
    }

    let colorObjects: any[] = [];
    if (candidates.length && product.options.some((option: any) => option.linkedMetafield)) {
      const dictionary = await gqlRead(`query{metaobjects(type:"shopify--color-pattern",first:100){nodes{id displayName} pageInfo{hasNextPage}}}`);
      if (dictionary.metaobjects.pageInfo.hasNextPage) throw new Error("Catálogo de cores acima de 100 itens; precisa de conferência");
      colorObjects = dictionary.metaobjects.nodes;
    }
    const plan = buildPushPlan(candidates, product, Number(master.sale_price), colorObjects);
    if (plan.create.length > 100) return reply({ error: "Máximo de 100 variações por envio" }, 409);
    const preview = plan.create.map(({ owner }: any) => ({
      color: owner.color,
      size: owner.size || null,
      sku: owner.sku,
      gtin: owner.gtin || null,
      price: Number(master.sale_price),
    }));
    const base = {
      success: true,
      code,
      color: colorRow.color,
      shopify_product_id: String(colorRow.shopify_product_id),
      shopify_product_name: product.title,
      admin_url: `https://${domain}/admin/products/${colorRow.shopify_product_id}`,
      to_create: preview,
      existing_to_link: plan.links.length,
      option_values_to_add: plan.additions.length,
      photos_preserved: true,
    };
    if (dry_run) return reply({ ...base, dry_run: true });

    const checkMutation = (result: any) => {
      if (!result || result.userErrors?.length) {
        throw new Error(result?.userErrors?.map((error: any) => error.message).join("; ") || "Shopify não confirmou a operação");
      }
      return result;
    };
    for (const addition of plan.additions) {
      const data = await gqlMutation(
        `mutation($pid:ID!,$oid:ID!,$gid:String!){productOptionUpdate(productId:$pid,option:{id:$oid},optionValuesToAdd:[{linkedMetafieldValue:$gid}],variantStrategy:LEAVE_AS_IS){product{options{id name linkedMetafield{namespace key} optionValues{id name linkedMetafieldValue}}} userErrors{field message}}}`,
        { pid: productGid, oid: addition.optionId, gid: addition.gid },
      );
      product.options = checkMutation(data.productOptionUpdate).product.options;
    }

    const errors: string[] = [];
    const createdVariants: any[] = [];
    const links = [...plan.links];
    let created = 0;
    if (plan.create.length) {
      const inputs = plan.create.map(({ input }: any) => ({
        ...input,
        optionValues: resolvePushOptionInputs(input.optionValues, product.options),
      }));
      const data = await gqlMutation(
        `mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$pid,variants:$v){productVariants{id title barcode price selectedOptions{name value} image{url} inventoryItem{sku}} userErrors{field message}}}`,
        { pid: productGid, v: inputs },
      );
      const result = data.productVariantsBulkCreate;
      const claimed = new Set<string>();
      for (const variant of result?.productVariants || []) {
        const matched = matchCreatedVariant(variant, plan.create.filter(({ owner }: any) => !claimed.has(owner.id)));
        if (!matched) {
          errors.push("Uma variação criada não teve SKU/GTIN local confirmado; confira antes de repetir.");
          continue;
        }
        claimed.add(matched.owner.id);
        links.push({ variant_id: matched.owner.id, shopify_variant_id: numericShopifyId(variant.id) });
        createdVariants.push(variant);
        created++;
      }
      if (result?.userErrors?.length) errors.push(...result.userErrors.map((error: any) => error.message));
      if (!result) errors.push("Criação não confirmada pela Shopify; confira o anúncio antes de repetir.");
    }

    if (links.length) {
      const { error } = await db.rpc("apply_shopify_links", {
        _links: links.map((link) => ({ ...link, master_id: colorRow.master_id, shopify_product_id: String(colorRow.shopify_product_id) })),
      });
      if (error) throw new Error("Variações existem na Shopify, mas o vínculo local não foi salvo; confira antes de repetir.");
    }

    const mirrorRows = [...plan.existingVariants, ...createdVariants].map((variant: any) => ({
      shopify_variant_id: numericShopifyId(variant.id),
      shopify_product_id: String(colorRow.shopify_product_id),
      product_title: product.title,
      product_status: product.status,
      published_lovable: !!product.publishedOnPublication,
      variant_title: variant.title || null,
      sku: variant.inventoryItem?.sku || null,
      barcode: variant.barcode || null,
      option_color: pickOption(variant, /cor|colou?r/),
      option_size: pickOption(variant, /tamanho|tam|size|numera/),
      price: variant.price != null ? Number(variant.price) : null,
      image_url: variant.image?.url || product.featuredMedia?.preview?.image?.url || null,
      synced_at: new Date().toISOString(),
    }));
    if (mirrorRows.length) {
      const { error } = await db.from("shopify_variant_mirror").upsert(mirrorRows, { onConflict: "shopify_variant_id" });
      if (error) throw new Error(`Variações vinculadas, mas o espelho não foi atualizado: ${error.message}`);
    }
    const { data: relink, error: relinkError } = await db.rpc("relink_products_from_shopify_mirror");
    if (relinkError) throw new Error(`Vínculos salvos, mas a revisão dos códigos falhou: ${relinkError.message}`);

    return reply({
      ...base,
      dry_run: false,
      success: errors.length === 0,
      created,
      linked_existing: plan.links.length,
      errors,
      relink: relink ?? null,
      message: errors.length ? "Envio concluído com pendências; confira os erros antes de repetir." : `${created} variação(ões) criada(s), sem alterar fotos ou outras cores.`,
    });
  } catch (error) {
    console.error("push-color-to-shopify", error instanceof Error ? error.message : "erro");
    return reply({ error: error instanceof Error ? error.message : "Não foi possível enviar a cor" }, 409);
  }
}));
