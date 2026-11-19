export interface A4Layout { top: number; left: number; colGap: number; rowGap: number }

export type SheetId = "a4" | "letter30";
export interface SheetSpec {
  id: SheetId;
  pageW: number; pageH: number;
  cols: number; rows: number;
  labelW: number; labelH: number;
  perSheet: number;
  defaultLayout: A4Layout;
  layoutKey: string;
}

export const A4_27: SheetSpec = {
  id: "a4", pageW: 210, pageH: 297, cols: 3, rows: 9, labelW: 63.5, labelH: 31, perSheet: 27,
  defaultLayout: { top: 9, left: 7.2, colGap: 2.5, rowGap: 0 }, layoutKey: "label-a4-layout-v1",
};
export const LETTER_30: SheetSpec = {
  id: "letter30", pageW: 215.9, pageH: 279.4, cols: 3, rows: 10, labelW: 66.7, labelH: 25.4, perSheet: 30,
  defaultLayout: { top: 12.7, left: 4.8, colGap: 3.2, rowGap: 0 }, layoutKey: "label-letter30-layout-v1",
};
export const SHEETS: Record<SheetId, SheetSpec> = { a4: A4_27, letter30: LETTER_30 };

// Compatibilidade com o A4 atual.
export const LABELS_PER_SHEET = A4_27.perSheet;
export const LABEL_W = A4_27.labelW;
export const LABEL_H = A4_27.labelH;

/** Posição (mm) da célula na folha. */
export function cellPosition(index: number, l: A4Layout, s: SheetSpec = A4_27) {
  const col = index % s.cols;
  const row = Math.floor(index / s.cols);
  return { x: l.left + col * (s.labelW + l.colGap), y: l.top + row * (s.labelH + l.rowGap) };
}

/** Distribui as etiquetas em folhas; as primeiras (startPos-1) posições ficam em branco. */
export function paginate<T>(cells: T[], startPos: number, s: SheetSpec = A4_27): (T | null)[][] {
  const blanks = Math.min(s.perSheet - 1, Math.max(0, startPos - 1));
  const all: (T | null)[] = [...Array(blanks).fill(null), ...cells];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < all.length; i += s.perSheet) pages.push(all.slice(i, i + s.perSheet));
  return pages;
}

export function sheetCount(labels: number, startPos: number, s: SheetSpec = A4_27) {
  return labels > 0 ? Math.ceil((labels + startPos - 1) / s.perSheet) : 0;
}

export function buildA4Pages(cells: string[], startPos: number, l: A4Layout, outline = false, s: SheetSpec = A4_27): string {
  return paginate(cells, startPos, s).map((page) =>
    `<div class="page">${page.map((c, i) => {
      if (c == null) return "";
      const p = cellPosition(i, l, s);
      return `<div class="cell${outline ? " outline" : ""}" style="left:${p.x}mm;top:${p.y}mm">${c}</div>`;
    }).join("")}</div>`).join("");
}
