export interface PromotionTier {
  qty: number;
  price: number;
}

export interface PromotionCopySource {
  name: string;
  shopify_collection_handle?: string | null;
  shopify_product_ids: string[] | null;
  tiers: PromotionTier[] | unknown;
  free_shipping: boolean;
  blocks_cashback: boolean;
  is_active: boolean;
}

export interface PromotionLinkRow {
  id: string;
  shopify_product_id: string | null;
  promotion_id: string | null;
}

export const numericShopifyId = (value?: string | null) =>
  String(value || "").split("/").pop()?.replace(/\D/g, "") || "";

export function normalizePromotionTiers(value: unknown): PromotionTier[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tier: any) => ({
      qty: Number(tier?.qty ?? tier?.quantity ?? 0),
      price: Number(tier?.price ?? 0),
    }))
    .filter((tier) => tier.qty > 0 && tier.price > 0);
}

export function promotionProductIds(value: string[] | null | undefined): string[] {
  return [...new Set((value || []).map(numericShopifyId).filter(Boolean))];
}

/** Cria os dados da cópia sem alterar o objeto da live de origem. */
export function promotionCopyPayload(source: PromotionCopySource, eventId: string, name = source.name) {
  return {
    event_id: eventId,
    name: name.trim(),
    shopify_collection_handle: source.shopify_collection_handle || null,
    shopify_product_ids: promotionProductIds(source.shopify_product_ids),
    tiers: normalizePromotionTiers(source.tiers),
    free_shipping: !!source.free_shipping,
    blocks_cashback: !!source.blocks_cashback,
    is_active: !!source.is_active,
  };
}

export const samePromotionName = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), "pt-BR", { sensitivity: "accent" }) === 0;

/** “Criar outra” nunca substitui uma promoção já existente. */
export function nextPromotionCopyName(baseName: string, existingNames: string[]): string {
  const base = baseName.trim();
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? "(cópia)" : `(cópia ${index})`;
    const candidate = `${base} ${suffix}`;
    if (!existingNames.some((name) => samePromotionName(name, candidate))) return candidate;
  }
  return `${base} (cópia ${Date.now()})`;
}

/**
 * Replica o vínculo do editor: produtos listados recebem a promoção e, ao
 * substituir, vínculos antigos fora da lista são removidos.
 */
export function planPromotionLinks(
  promotionId: string,
  sourceProductIds: string[] | null | undefined,
  catalogRows: PromotionLinkRow[],
  crosssellRows: PromotionLinkRow[],
) {
  const ids = promotionProductIds(sourceProductIds);
  const listed = (row: PromotionLinkRow) => ids.includes(numericShopifyId(row.shopify_product_id));
  const link = (rows: PromotionLinkRow[]) => rows.filter((row) => listed(row) && row.promotion_id !== promotionId).map((row) => row.id);
  const unlink = (rows: PromotionLinkRow[]) => rows.filter((row) => row.promotion_id === promotionId && !listed(row)).map((row) => row.id);
  const present = new Set(
    [...catalogRows, ...crosssellRows]
      .filter(listed)
      .map((row) => numericShopifyId(row.shopify_product_id)),
  );

  return {
    catalogIds: link(catalogRows),
    crosssellIds: link(crosssellRows),
    catalogOffIds: unlink(catalogRows),
    crosssellOffIds: unlink(crosssellRows),
    catalogCount: catalogRows.filter(listed).length,
    crosssellCount: crosssellRows.filter(listed).length,
    linkedCount: present.size,
    missingProductIds: ids.filter((id) => !present.has(id)),
  };
}

export function formatPromotionEventDate(value?: string | null): string {
  if (!value) return "sem data";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "sem data";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}
