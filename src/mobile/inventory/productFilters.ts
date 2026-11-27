export interface MobileProductFilters { activeOnly: boolean; inStock: boolean; categoryIds: string[] }
export const EMPTY_FILTERS: MobileProductFilters = { activeOnly: false, inStock: false, categoryIds: [] };
export const FILTERS_KEY = "m-estoque-filters-v1";
export const PAGE_SIZE = 30;

export function hasAnyFilter(f: MobileProductFilters) { return f.activeOnly || f.inStock || f.categoryIds.length > 0; }
/** Lista só aparece com filtro ligado ou texto; sem nada, a tela fica como antes. */
export function shouldList(f: MobileProductFilters, term: string) { return hasAnyFilter(f) || term.trim().length > 0; }

export function loadFilters(): MobileProductFilters {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTERS_KEY) || "null");
    if (!raw || typeof raw !== "object") return EMPTY_FILTERS;
    return {
      activeOnly: raw.activeOnly === true,
      inStock: raw.inStock === true,
      categoryIds: Array.isArray(raw.categoryIds) ? raw.categoryIds.filter((x: unknown) => typeof x === "string").slice(0, 50) : [],
    };
  } catch { return EMPTY_FILTERS; }
}
export function saveFilters(f: MobileProductFilters) { try { localStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch { /* aparelho sem storage */ } }

export function rpcParams(f: MobileProductFilters, term: string, page: number) {
  return {
    p_term: term.trim() || null, p_active_only: f.activeOnly, p_in_stock: f.inStock,
    p_category_ids: f.categoryIds.length ? f.categoryIds : null, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
  };
}
export function categoryChipLabel(ids: string[], names: Record<string, string>) {
  if (!ids.length) return "Categoria";
  const first = names[ids[0]] || "1 categoria";
  return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
}
/** Mescla páginas sem repetir produto. */
export function mergePage<T extends { id: string }>(prev: T[], next: T[]) {
  const seen = new Set(prev.map((p) => p.id));
  return [...prev, ...next.filter((n) => !seen.has(n.id))];
}
