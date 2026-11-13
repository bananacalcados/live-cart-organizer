export const LABELS_PER_SHEET = 27;
export const LABEL_W = 63.5;
export const LABEL_H = 31;
export interface A4Layout { top: number; left: number; colGap: number; rowGap: number }

/** Posição (mm) da célula 0..26 na folha: 3 colunas × 9 linhas. */
export function cellPosition(index: number, l: A4Layout) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: l.left + col * (LABEL_W + l.colGap), y: l.top + row * (LABEL_H + l.rowGap) };
}

/** Distribui as etiquetas em folhas; as primeiras (startPos-1) posições ficam em branco. */
export function paginate<T>(cells: T[], startPos: number): (T | null)[][] {
  const blanks = Math.min(26, Math.max(0, startPos - 1));
  const all: (T | null)[] = [...Array(blanks).fill(null), ...cells];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < all.length; i += LABELS_PER_SHEET) pages.push(all.slice(i, i + LABELS_PER_SHEET));
  return pages;
}

export function buildA4Pages(cells: string[], startPos: number, l: A4Layout, outline = false): string {
  return paginate(cells, startPos).map((page) =>
    `<div class="page">${page.map((c, i) => {
      if (c == null) return "";
      const p = cellPosition(i, l);
      return `<div class="cell${outline ? " outline" : ""}" style="left:${p.x}mm;top:${p.y}mm">${c}</div>`;
    }).join("")}</div>`).join("");
}
