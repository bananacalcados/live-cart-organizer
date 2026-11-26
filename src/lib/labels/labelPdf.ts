import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import { cellPosition, paginate, LETTER_30, type A4Layout, type SheetSpec } from "./a4Sheet";

export interface PdfLabel { name: string; code: string; variant: string; price?: number | null }

/** Lista de etiquetas (uma por cópia), na mesma ordem e conteúdo da impressão do computador. */
export function expandLabels(
  items: { id: string; code?: string | null; color?: string | null; size?: string | null; name?: string | null; price?: number | null }[],
  quantities: Record<string, number>, fallbackName: string, fallbackPrice: number | null,
): PdfLabel[] {
  const out: PdfLabel[] = [];
  for (const v of items) {
    const n = quantities[v.id] || 0;
    if (n <= 0 || !v.code) continue;
    const label = { name: v.name || fallbackName, code: v.code, variant: [v.color, v.size].filter(Boolean).join(" · "), price: v.price ?? fallbackPrice };
    for (let i = 0; i < n; i++) out.push(label);
  }
  return out;
}

function barcodePng(code: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, code, { format: "CODE128", width: 3, height: 90, displayValue: false, margin: 0, lineColor: "#000", background: "#fff" });
  return canvas.toDataURL("image/png");
}

const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** PDF Carta 30 etiquetas (66,7 x 25,4 mm), mesmas posições da folha impressa no computador. */
export function buildLabelPdf(labels: PdfLabel[], opts: { showPrice?: boolean; startPos?: number; layout?: A4Layout; sheet?: SheetSpec } = {}): Blob {
  const sheet = opts.sheet ?? LETTER_30;
  const layout = opts.layout ?? sheet.defaultLayout;
  const doc = new jsPDF({ unit: "mm", format: [sheet.pageW, sheet.pageH] });
  const cache = new Map<string, string>();
  const pages = paginate(labels, opts.startPos ?? 1, sheet);
  pages.forEach((page, pi) => {
    if (pi > 0) doc.addPage([sheet.pageW, sheet.pageH]);
    page.forEach((l, i) => {
      if (!l) return;
      const { x, y } = cellPosition(i, layout, sheet);
      const px = x + 2.5, w = sheet.labelW - 5;
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
      doc.text(doc.splitTextToSize(l.name, w)[0] || "", px, y + 4);
      doc.setFontSize(14); doc.text(l.code, px, y + 10);
      doc.setFontSize(7.5); doc.text(l.variant, x + sheet.labelW - 2.5, y + 10, { align: "right", maxWidth: w / 2 });
      if (!cache.has(l.code)) cache.set(l.code, barcodePng(l.code));
      doc.addImage(cache.get(l.code)!, "PNG", px, y + sheet.labelH - 1.5 - 7.5, w * 0.8, 7.5);
      if (opts.showPrice && l.price) doc.text(brl(Number(l.price)), x + sheet.labelW - 2.5, y + sheet.labelH - 2, { align: "right" });
    });
  });
  return doc.output("blob");
}
