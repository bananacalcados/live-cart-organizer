/**
 * Atribuição de origem dos pedidos da Shopify.
 *
 * O site grava as UTMs no `note_attributes` do pedido. Aqui a gente extrai
 * esses campos, identifica se a venda veio de uma Link Page nossa (via
 * `lp_click`, o id único do clique gerado em src/lib/marketing/linkPageUtm.ts)
 * e devolve os campos prontos para gravar em `pos_sales`.
 */

export interface ShopifyAttribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  lp_click_id: string | null;
  attribution_source: string | null;
}

const clean = (v: unknown, max = 200): string | null => {
  const s = (v ?? "").toString().trim();
  return s ? s.slice(0, max) : null;
};

function attr(notes: any[], ...patterns: RegExp[]): string | null {
  for (const a of notes || []) {
    const name = (a?.name || "").toString();
    if (patterns.some((p) => p.test(name))) {
      const v = clean(a?.value);
      if (v) return v;
    }
  }
  return null;
}

function fromUrl(url: string | null | undefined, key: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "https://x.invalid");
    return clean(u.searchParams.get(key));
  } catch {
    return null;
  }
}

/**
 * Extrai UTMs do pedido: prioriza `note_attributes`, com fallback para a
 * landing_site (URL de entrada gravada pela própria Shopify).
 */
export function extractShopifyAttribution(order: any): ShopifyAttribution {
  const notes = order?.note_attributes || [];
  const landing: string | null = order?.landing_site || order?.landing_site_ref || null;

  const pick = (key: string, ...extra: RegExp[]) =>
    attr(notes, new RegExp(`^${key}$`, "i"), ...extra) || fromUrl(landing, key);

  const utm_source = pick("utm_source", /^source$/i);
  const utm_medium = pick("utm_medium", /^medium$/i);
  const utm_campaign = pick("utm_campaign", /^campaign$/i);
  const utm_content = pick("utm_content", /^content$/i);
  const utm_term = pick("utm_term", /^term$/i);
  const lp_click_id =
    attr(notes, /^lp_click$/i, /^lp[_-]?click[_-]?id$/i, /^linkpage[_-]?click$/i) ||
    fromUrl(landing, "lp_click");

  // Mecanismo de origem: link page tem prioridade (é sinal direto nosso).
  let attribution_source: string | null = null;
  if (lp_click_id) attribution_source = "link_page";
  else if (utm_medium && /catalog_product|linkpage|link_page/i.test(utm_medium)) attribution_source = "link_page";
  else if (utm_source && /^(linkpage|link_page)$/i.test(utm_source)) attribution_source = "link_page";
  else if (utm_source && /(fb|facebook|ig|instagram|meta)/i.test(utm_source)) attribution_source = "meta_ads";
  else if (utm_source && /google/i.test(utm_source)) attribution_source = "google";
  else if (utm_source) attribution_source = "utm";

  return {
    utm_source: clean(utm_source),
    utm_medium: clean(utm_medium),
    utm_campaign: clean(utm_campaign),
    utm_content: clean(utm_content),
    utm_term: clean(utm_term),
    lp_click_id: lp_click_id ? lp_click_id.slice(0, 40) : null,
    attribution_source,
  };
}

/**
 * Resolve os campos de Link Page (página / botão / produto) a partir do clique
 * registrado em `link_page_visits`. Retorna os campos extras para o insert.
 */
export async function resolveLinkPageAttribution(
  supabase: any,
  att: ShopifyAttribution,
): Promise<{
  link_page_id: string | null;
  link_page_item_id: string | null;
  link_page_catalog_product_id: string | null;
  visit_id: string | null;
}> {
  const empty = { link_page_id: null, link_page_item_id: null, link_page_catalog_product_id: null, visit_id: null };
  if (!att.lp_click_id) return empty;

  const { data: visit } = await supabase
    .from("link_page_visits")
    .select("id, page_id, item_id, catalog_product_id")
    .eq("click_id", att.lp_click_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!visit) return empty;
  return {
    link_page_id: visit.page_id || null,
    link_page_item_id: visit.item_id || null,
    link_page_catalog_product_id: visit.catalog_product_id || null,
    visit_id: visit.id,
  };
}

/** Marca o clique da Link Page como convertido (idempotente). */
export async function markLinkPageConversion(
  supabase: any,
  visitId: string | null,
  opts: { saleId: string; externalOrderId: string; total: number },
): Promise<void> {
  if (!visitId) return;
  await supabase
    .from("link_page_visits")
    .update({
      converted_at: new Date().toISOString(),
      conversion_value: opts.total,
      conversion_external_order_id: opts.externalOrderId,
      pos_sale_id: opts.saleId,
    })
    .eq("id", visitId)
    .is("converted_at", null);
}
