// Fase D — Marketing com produtos do ERP (interruptor app_settings.product_source_marketing).
// Com "shopify" tudo continua chamando fetchProducts da Shopify, igual a antes.
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { erpItemToShopifyProduct, getProductSource, parseShopifyQuery, searchErpCatalog, type ErpCatalogItem } from "@/lib/liveProductSource";

/** Seletor das telas de criação do Marketing. */
export async function fetchMarketingProducts(limit = 250, searchQuery?: string, opts?: { newestFirst?: boolean }): Promise<ShopifyProduct[]> {
  const src = await getProductSource("product_source_marketing");
  if (src !== "erp") return fetchProducts(limit, searchQuery, opts);
  try {
    const { ids, term } = parseShopifyQuery(searchQuery);
    const { products } = await searchErpCatalog({ ids, term, limit: Math.min(limit, 50) });
    return await fillShopifyHandles(products);
  } catch (e) {
    console.error("erp_catalog_search", e);
    return [];
  }
}

/**
 * Produto do ERP ligado à Shopify ainda tem página no site: busca o endereço (handle) numa única
 * consulta. Se a Shopify não responder, fica sem endereço e o clique vai para o WhatsApp (nunca link quebrado).
 */
export async function fillShopifyHandles(products: ShopifyProduct[]): Promise<ShopifyProduct[]> {
  const linked = products.filter((p) => p.node.id.startsWith("gid://shopify/Product/") && !p.node.handle);
  if (!linked.length) return products;
  try {
    const q = linked.map((p) => `id:${p.node.id.split("/").pop()}`).join(" OR ");
    const found = await fetchProducts(linked.length, q);
    const byId = new Map(found.map((f) => [f.node.id, f.node.handle]));
    for (const p of linked) p.node.handle = byId.get(p.node.id) || "";
  } catch { /* sem endereço = WhatsApp */ }
  return products;
}

export const ERP_PRODUCT_PREFIX = "erp-product:";
export const erpMasterFromId = (id: string | null | undefined): string | null => {
  const m = String(id || "").match(/^erp-product:([0-9a-f-]{36})$/i);
  return m ? m[1] : null;
};

/** Páginas públicas: resolve só os ids "erp-product:" guardados (páginas antigas não têm nenhum). */
export async function fetchPublicErpProducts(ids: Array<string | null | undefined>): Promise<ShopifyProduct[]> {
  const masters = [...new Set(ids.map(erpMasterFromId).filter(Boolean))] as string[];
  if (!masters.length) return [];
  try {
    const { data, error } = await supabase.functions.invoke("marketing-catalog-public", { body: { ids: masters.slice(0, 50) } });
    if (error) throw error;
    const items = ((data?.items || []) as Array<ErpCatalogItem & { variants: Array<{ in_stock?: boolean }> }>);
    return items.map((it) => {
      const p = erpItemToShopifyProduct({ ...it, variants: it.variants.map((v: any) => ({ ...v, stock_perola: v.in_stock ? 1 : 0 })) });
      // Sempre pelo id do ERP: é ele que a página guardou.
      p.node.id = `${ERP_PRODUCT_PREFIX}${it.master_id}`;
      // Vitrine pública mostra só o que tem estoque (como a Shopify já fazia nessas páginas).
      for (const e of p.node.variants.edges) e.node.availableForSale = (e.node.quantityAvailable ?? 0) > 0;
      return p;
    });
  } catch (e) {
    console.error("marketing-catalog-public", e);
    return [];
  }
}

/**
 * Destino do clique para produto sem página no site: WhatsApp de atendimento do dia dos Grupos VIP
 * (só instâncias liberadas para atendimento), com o produto na mensagem montada no servidor.
 */
export function erpProductWhatsAppUrl(masterId: string, color?: string | null): string {
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vip-go?p=${encodeURIComponent(masterId)}`;
  return color ? `${base}&cor=${encodeURIComponent(color)}` : base;
}
