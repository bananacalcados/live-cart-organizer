export interface PresenterVariantSizeRow {
  master_id: string;
  color: string | null;
  size: string | null;
}

export const normalizePresenterSize = (value: string | null | undefined) =>
  String(value || "").trim().toLocaleUpperCase("pt-BR");

export const presenterVariantKey = (masterId: string | null | undefined, color: string | null | undefined) =>
  `${masterId || ""}|${String(color || "").trim().toLocaleLowerCase("pt-BR")}`;

export function sortPresenterSizes(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
}

/** Agrupa as numerações ativas por produto+cor sem consultar item por item. */
export function groupPresenterSizes(variants: PresenterVariantSizeRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const variant of variants) {
    if (!variant.size) continue;
    const key = presenterVariantKey(variant.master_id, variant.color);
    grouped.set(key, [...(grouped.get(key) || []), variant.size]);
  }
  grouped.forEach((sizes, key) => grouped.set(key, sortPresenterSizes(sizes)));
  return grouped;
}

/** NULL é o estado legado e significa todas liberadas; array vazio bloqueia todas. */
export function isPresenterSizeAllowed(availableSizes: string[] | null | undefined, size: string): boolean {
  if (availableSizes == null) return true;
  const wanted = normalizePresenterSize(size);
  return availableSizes.some((allowed) => normalizePresenterSize(allowed) === wanted);
}

export function togglePresenterSize(
  availableSizes: string[] | null,
  allSizes: string[],
  size: string,
): string[] | null {
  const current = availableSizes == null ? allSizes : availableSizes;
  const next = isPresenterSizeAllowed(current, size)
    ? current.filter((allowed) => normalizePresenterSize(allowed) !== normalizePresenterSize(size))
    : [...current, size];
  const sorted = sortPresenterSizes(next);
  return sorted.length === sortPresenterSizes(allSizes).length ? null : sorted;
}

const normalizePresenterSearch = (value: string | null | undefined) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");

/** Busca local dos produtos já carregados; todos os termos precisam aparecer. */
export function presenterProductMatches(
  row: { code: string; product_name: string | null; color: string | null },
  query: string,
): boolean {
  const terms = normalizePresenterSearch(query).split(/\s+/).filter(Boolean);
  const haystack = normalizePresenterSearch([row.code, row.product_name, row.color].filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}

export function presenterConditionsChanged(
  row: { offer_price: number | null; free_shipping: boolean },
  patch: { offer_price?: number; free_shipping?: boolean },
): boolean {
  return (patch.offer_price != null && Number(row.offer_price) !== patch.offer_price)
    || (patch.free_shipping != null && row.free_shipping !== patch.free_shipping);
}

export function buildBulkPresenterPatch(input: {
  offerPrice: string;
  freeShipping: "keep" | "yes" | "no";
}): { offer_price?: number; free_shipping?: boolean } {
  const patch: { offer_price?: number; free_shipping?: boolean } = {};
  const raw = input.offerPrice.trim();
  if (raw) {
    const parsed = Number(raw.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Informe um preço de oferta válido");
    patch.offer_price = parsed;
  }
  if (input.freeShipping !== "keep") patch.free_shipping = input.freeShipping === "yes";
  return patch;
}
