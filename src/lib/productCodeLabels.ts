import jsPDF from "jspdf";

export interface ProductCodeLabelItem {
  code: string;
  product_name: string | null;
  color: string | null;
  sale_price: number | null;
  offer_price?: number | null;
}

export const brlLabel = (value: number | null | undefined) =>
  `R$ ${Number(value ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Só considera desconto real: preço promocional positivo e menor que o cheio. */
export function labelOfferPrice(item: Pick<ProductCodeLabelItem, "sale_price" | "offer_price">): number | null {
  const full = Number(item.sale_price);
  const offer = Number(item.offer_price);
  return Number.isFinite(full) && Number.isFinite(offer) && offer > 0 && offer < full ? offer : null;
}

/** Mesma etiqueta A4 de Estoque > Códigos; com oferta, mostra o cheio e o promocional. */
export function printProductCodeLabels(list: ProductCodeLabelItem[], filenameDate = new Date()) {
  if (!list.length) throw new Error("Nenhum código para exportar");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 80, H = 50, GAP = 4, cols = 2, rowsPer = 5;
  const mx = (210 - (cols * W + (cols - 1) * GAP)) / 2;
  const my = (297 - (rowsPer * H + (rowsPer - 1) * GAP)) / 2;

  list.forEach((item, index) => {
    const pos = index % (cols * rowsPer);
    if (index > 0 && pos === 0) doc.addPage();
    const x = mx + (pos % cols) * (W + GAP);
    const y = my + Math.floor(pos / cols) * (H + GAP);
    const offer = labelOfferPrice(item);

    doc.setDrawColor(200); doc.setLineWidth(0.1); doc.rect(x, y, W, H);
    doc.setFont("helvetica", "bold"); doc.setFontSize(64);
    doc.text(item.code, x + W / 2, y + 22, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    const nameLines = doc.splitTextToSize(item.product_name ?? "", W - 6).slice(0, 2);
    doc.text(nameLines, x + 3, y + 30);
    const nextY = y + 30 + nameLines.length * 3.8;
    if (item.color) {
      doc.setFont("helvetica", "bold");
      doc.text(doc.splitTextToSize(item.color, W - 6)[0], x + 3, nextY);
    }

    if (offer == null) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(brlLabel(item.sale_price), x + W - 3, y + H - 3, { align: "right" });
    } else {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`De ${brlLabel(item.sale_price)}`, x + W - 3, y + H - 10, { align: "right" });
      doc.setFont("helvetica", "bold"); doc.setFontSize(14);
      doc.text(`Por ${brlLabel(offer)}`, x + W - 3, y + H - 3, { align: "right" });
    }
  });

  const date = filenameDate.toISOString().slice(0, 10);
  doc.save(`etiquetas-codigos-${date}.pdf`);
}
