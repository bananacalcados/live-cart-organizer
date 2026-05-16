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
};

/** Group variants by parent_sku and compute grade coverage per parent. */
export function computeParentSummaries(rows: VariantRow[]): ParentSummary[] {
  const map = new Map<string, VariantRow[]>();
  for (const r of rows) {
    const key = r.parent_sku || `__${r.name || "?"}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const out: ParentSummary[] = [];
  for (const [parent_sku, variants] of map.entries()) {
    const first = variants[0];
    const gender = first.gender;
    const expected = getGradeRange(gender);
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
    out.push({
      parent_sku,
      displayName: cleanDisplayName(first.name),
      category_id: first.category_id,
      gender,
      expectedSizes: expected,
      presentSizes: presentArr,
      missingSizes: missing,
      totalPairs,
      saleValue,
      isComplete: missing.length === 0,
      coveragePct: coverage,
    });
  }
  return out;
}

/** Strip the trailing " - SIZE" / " - COLOR - SIZE" tail from name for display. */
function cleanDisplayName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.split("-").map(p => p.trim());
  // Drop trailing tokens that are pure size (numeric)
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (SIZE_RE.test(last)) parts.pop();
    else break;
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
