/**
 * UTM de saída das Link Pages.
 *
 * Todo link que sai de uma Link Page para o site (botão "Site", produtos do
 * catálogo, etc.) recebe UTMs padronizadas + um `lp_click` único. Com isso a
 * venda no site pode ser atribuída depois à página, ao botão e ao produto exato.
 *
 * Convenção:
 *   utm_source   = slug (nome) da link page — ex.: "lancamento-conforto"
 *   utm_medium   = tipo do botão (website, catalog_product, link, vip...)
 *   utm_campaign = slug da link page (mantido para compatibilidade)
 *   utm_content  = identificador do botão/produto (slug legível + id curto)
 *   utm_term     = vendedora (quando houver)
 *   lp_click     = id único do clique (casa com link_page_visits.click_id)
 */

import { appendAttributionParams } from "@/lib/metaAttribution";

function slugify(v: string | null | undefined, max = 40): string {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function newClickId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return (crypto as any).randomUUID().replace(/-/g, "").slice(0, 20);
    }
  } catch {
    /* ignore */
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export interface OutboundUtmInput {
  url: string;
  pageSlug?: string | null;
  itemType?: string | null;
  itemLabel?: string | null;
  itemId?: string | null;
  productHandle?: string | null;
  productTitle?: string | null;
  productId?: string | null;
  sellerName?: string | null;
  clickId: string;
}

/**
 * Anexa as UTMs da Link Page à URL de destino (apenas http/https).
 * Sobrescreve UTMs herdadas do anúncio — a origem imediata da visita ao site
 * é a Link Page. Os sinais da Meta (fbclid) continuam sendo repassados.
 */
export function decorateOutboundUrl(input: OutboundUtmInput): string {
  const { url } = input;
  if (!url || !/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    const isProduct = Boolean(input.productHandle || input.productId);

    const content = isProduct
      ? slugify(input.productHandle || input.productTitle) || String(input.productId || "")
      : slugify(input.itemLabel || input.itemType) || String(input.itemId || "");

    // utm_source = nome (slug) da própria Link Page, ex.: "lancamento-conforto".
    // Fallback para "linkpage" quando a página não tiver slug.
    u.searchParams.set("utm_source", slugify(input.pageSlug, 60) || "linkpage");
    u.searchParams.set("utm_medium", isProduct ? "catalog_product" : slugify(input.itemType) || "button");
    if (input.pageSlug) u.searchParams.set("utm_campaign", slugify(input.pageSlug, 60));
    if (content) u.searchParams.set("utm_content", content);
    if (input.sellerName) u.searchParams.set("utm_term", slugify(input.sellerName));
    u.searchParams.set("lp_click", input.clickId);

    // Repassa fbclid (a função só adiciona o que ainda não existe).
    return appendAttributionParams(u.toString());
  } catch {
    return url;
  }
}
