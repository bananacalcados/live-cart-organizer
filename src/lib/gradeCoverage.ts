// Grade coverage utilities — parse sizes from product names and compute
// "complete grade" status per parent_sku for inventory health.

export type Gender = "feminino" | "masculino" | "unissex" | "infantil" | string;

export const GRADE_RANGES: Record<string, number[]> = {
  feminino: [34, 35, 36, 37, 38, 39],
  masculino: [37, 38, 39, 40, 41, 42, 43],
  unissex: [35, 36, 37, 38, 39, 40, 41, 42],
  infantil: [25, 26, 27, 28, 29, 30, 31, 32, 33],
};

const SIZE_RE = /^(\d{2})(?:\/(\d{2}))?$/;

/** Parse the numeric size from a product name. Looks at the last dash-separated
 *  tokens and returns the first numeric token (eg "38" or "33/34" => 33). */
export function parseSizeFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const parts = name.split("-").map(p => p.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i].match(SIZE_RE);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 15 && n <= 50) return n;
    }
  }
  return null;
}

export function getGradeRange(gender: Gender | null | undefined): number[] {
  if (!gender) return GRADE_RANGES.unissex;
  return GRADE_RANGES[gender] || GRADE_RANGES.unissex;
}

export type VariantRow = {
  parent_sku: string | null;
  name: string | null;
  stock: number | null;
  price: number | null;
  cost_price: number | null;
  category_id: string | null;
  gender: string | null;
  store_id?: string | null;
  sku?: string | null;
};

/** Optional per-parent overrides fed from Legacy (products_master + product_variants).
 *  When provided, we prefer these over what we can guess from pos_products names. */
export type LegacyParentMeta = {
  displayName?: string | null;
  category_id?: string | null;
  gender?: string | null;
  /** Real registered sizes from product_variants. If empty, falls back to gender range. */
  variantSizes?: number[];
};

export type ParentSummary = {
  parent_sku: string;
  displayName: string;
  category_id: string | null;
  gender: string | null;
  expectedSizes: number[];
  presentSizes: number[]; // sizes with stock > 0
  missingSizes: number[];
  totalPairs: number;
  saleValue: number;
  isComplete: boolean;
  coveragePct: number; // 0-100
  /** true when this parent_sku exists in Legacy (products_master). */
  inLegacy: boolean;
};

/** Group variants by parent_sku and compute grade coverage per parent.
 *  When `legacyMap` is provided, uses Legacy metadata (name/gender/category/sizes)
 *  as the source of truth and, if `onlyLegacy` is true, drops any parent_sku not
 *  registered in Legacy. */
export function computeParentSummaries(
  rows: VariantRow[],
  opts?: { legacyMap?: Map<string, LegacyParentMeta>; onlyLegacy?: boolean },
): ParentSummary[] {
  const legacyMap = opts?.legacyMap;
  const onlyLegacy = !!opts?.onlyLegacy;
  const map = new Map<string, VariantRow[]>();
  for (const r of rows) {
    const key = r.parent_sku || `__${r.name || "?"}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const out: ParentSummary[] = [];
  for (const [parent_sku, variants] of map.entries()) {
    const legacy = legacyMap?.get(parent_sku);
    const inLegacy = !!legacy;
    if (onlyLegacy && !inLegacy) continue;

    const first = variants[0];
    const gender = legacy?.gender ?? first.gender;
    const category_id = legacy?.category_id ?? first.category_id;
    const expected =
      legacy?.variantSizes && legacy.variantSizes.length > 0
        ? [...legacy.variantSizes].sort((a, b) => a - b)
        : getGradeRange(gender);
    const present = new Set<number>();
    let totalPairs = 0;
    let saleValue = 0;
    for (const v of variants) {
      const size = parseSizeFromName(v.name);
      const s = Number(v.stock ?? 0);
      if (s > 0 && size != null) present.add(size);
      if (s > 0) {
        totalPairs += s;
        saleValue += s * Number(v.price ?? 0);
      }
    }
    const presentArr = expected.filter(sz => present.has(sz));
    const missing = expected.filter(sz => !present.has(sz));
    const coverage = expected.length === 0 ? 0 : (presentArr.length / expected.length) * 100;
    const displayName =
      (legacy?.displayName && legacy.displayName.trim()) || cleanDisplayName(first.name);
    out.push({
      parent_sku,
      displayName,
      category_id,
      gender,
      expectedSizes: expected,
      presentSizes: presentArr,
      missingSizes: missing,
      totalPairs,
      saleValue,
      isComplete: missing.length === 0,
      coveragePct: coverage,
      inLegacy,
    });
  }
  return out;
}

/** Strip the trailing " - SIZE" / " - COLOR - SIZE" / " - SIZE - COLOR" tail so a
 *  variant name reads as a parent name. Drops up to 3 trailing "qualifier"
 *  tokens — sizes (numeric) or short non-numeric words (colors like "Branco",
 *  "Preto Pele", "Vinho"). */
function cleanDisplayName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.split("-").map(p => p.trim()).filter(Boolean);
  let dropped = 0;
  while (parts.length > 1 && dropped < 3) {
    const last = parts[parts.length - 1];
    const isSize = SIZE_RE.test(last);
    const looksLikeColor = !/\d/.test(last) && last.length > 0 && last.length <= 20;
    if (isSize || looksLikeColor) {
      parts.pop();
      dropped++;
    } else break;
  }
  return parts.join(" - ");
}

export type HealthBucket = "complete" | "broken" | "critical";

/** Bucket per coverage %: complete = 100%, broken = 50–99%, critical = <50%. */
export function healthBucket(pct: number, isComplete: boolean): HealthBucket {
  if (isComplete) return "complete";
  if (pct >= 50) return "broken";
  return "critical";
}

// ============================================================================
// Color-aware summaries: group by (master, color) using product_variants as the
// source of truth for expected sizes and pos_products.sku as the join key for
// stock. This models "1 modelo × 1 cor = 1 grade" instead of collapsing all
// colors of a parent_sku into a single row (which hides colors with stock when
// another color is empty).
// ============================================================================

export type MasterColorMeta = {
  color: string; // "" for masters without a color axis
  sizes: number[];
  /** size -> variant sku (used to match pos_products.sku for stock). */
  skuBySize: Record<number, string>;
};

export type MasterMeta = {
  sku_root: string;
  name: string;
  category_id: string | null;
  gender: string | null;
  colors: MasterColorMeta[];
};

export type PosSkuAgg = { stock: number; price: number };

/** Build summaries at the (master × color) grain.
 *  `posBySku` must already contain stock aggregated across the selected stores. */
export function computeColorSummaries(
  masters: MasterMeta[],
  posBySku: Map<string, PosSkuAgg>,
): ParentSummary[] {
  const out: ParentSummary[] = [];
  for (const m of masters) {
    const groups: MasterColorMeta[] =
      m.colors.length > 0 ? m.colors : [{ color: "", sizes: [], skuBySize: {} }];
    for (const g of groups) {
      const expected = [...g.sizes].sort((a, b) => a - b);
      let totalPairs = 0;
      let saleValue = 0;
      const present = new Set<number>();
      for (const size of expected) {
        const sku = g.skuBySize[size];
        if (!sku) continue;
        const agg = posBySku.get(sku);
        if (!agg) continue;
        if (agg.stock > 0) {
          present.add(size);
          totalPairs += agg.stock;
          saleValue += agg.stock * (agg.price || 0);
        }
      }
      const missing = expected.filter((sz) => !present.has(sz));
      const coverage =
        expected.length === 0 ? 0 : (present.size / expected.length) * 100;
      const displayName = g.color ? `${m.name} · ${g.color}` : m.name;
      out.push({
        parent_sku: `${m.sku_root}::${g.color || "_"}`,
        displayName,
        category_id: m.category_id,
        gender: m.gender,
        expectedSizes: expected,
        presentSizes: expected.filter((s) => present.has(s)),
        missingSizes: missing,
        totalPairs,
        saleValue,
        isComplete: expected.length > 0 && missing.length === 0,
        coveragePct: coverage,
        inLegacy: true,
      });
    }
  }
  return out;
}
