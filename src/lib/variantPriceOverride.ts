/** Preço próprio da variação só existe quando é diferente do pai (vazio, 0 ou igual = segue o pai). */
export function normalizeVariantOverride(value: string | number | null | undefined, parent: number | null | undefined): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  if (parent != null && isFinite(parent) && Math.abs(n - parent) < 0.005) return null;
  return n;
}

export interface PriceChangeSplit {
  followOld: number[]; // índices com preço próprio igual ao preço antigo do pai
  own: { index: number; price: number }[]; // índices com preço próprio diferente
}

export function splitOverridesOnParentChange(overrides: (string | null | undefined)[], oldParent: number, newParent: number): PriceChangeSplit {
  const res: PriceChangeSplit = { followOld: [], own: [] };
  if (!isFinite(oldParent) || !isFinite(newParent) || Math.abs(oldParent - newParent) < 0.005) return res;
  overrides.forEach((o, index) => {
    const n = parseFloat(String(o ?? "").replace(",", "."));
    if (!isFinite(n) || n <= 0) return;
    if (Math.abs(n - oldParent) < 0.005) res.followOld.push(index);
    else if (Math.abs(n - newParent) >= 0.005) res.own.push({ index, price: n });
  });
  return res;
}
