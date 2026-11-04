export interface GradeSize {
  size: string;
  qty: number;
}

/** Pares de uma grade (soma das quantidades por tamanho). */
export function pairsPerGrade(sizes: GradeSize[]): number {
  return sizes.reduce((s, x) => s + Math.max(0, Math.floor(Number(x.qty) || 0)), 0);
}

/** Total de pares de um item = grades × pares da grade. */
export function totalPairs(sizes: GradeSize[], gradesQty: number): number {
  return pairsPerGrade(sizes) * Math.max(0, Math.floor(Number(gradesQty) || 0));
}

/** Parse "34:1, 35:2, 36" (tamanho sem quantidade = 1). */
export function parseGradeSizes(text: string): GradeSize[] {
  return text
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [size, q] = t.split(/[:x×]/);
      const qty = q === undefined ? 1 : Math.floor(Number(q));
      return { size: size.trim(), qty: Number.isFinite(qty) && qty > 0 ? qty : 0 };
    })
    .filter((s) => s.size && s.qty > 0);
}

export function formatGradeSizes(sizes: GradeSize[]): string {
  return sizes.map((s) => `${s.size}:${s.qty}`).join(", ");
}
