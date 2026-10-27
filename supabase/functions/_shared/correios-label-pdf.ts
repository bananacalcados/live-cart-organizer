import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import { code128C, groupChave, maskCpf, type NfeSummary } from './correios-prepost-domain.ts';
const A4 = { w: 595.28, h: 841.89 };
export const THERMAL = { w: 100 * 72 / 25.4, h: 150 * 72 / 25.4 };
// Helvetica (WinAnsi) supports Latin-1 accents; strip anything outside it.
const safe = (s: unknown) => String(s ?? '').normalize('NFC').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, (c) => c.normalize('NFD').replace(/[^\x20-\x7E]/g, '') || '');
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function fit(text: string, font: PDFFont, size: number, max: number) { const full = safe(text); let t = full; while (t && font.widthOfTextAtSize(t === full ? t : `${t}...`, size) > max) t = t.slice(0, -1); return t === full ? t : `${t}...`; }
function drawDanfe(page: PDFPage, nfe: NfeSummary, font: PDFFont, bold: PDFFont, top: number) {
  const x = 30, w = A4.w - 60; let y = top - 24;
  const line = (label: string, value: string, size = 9) => { page.drawText(safe(label), { x, y, size, font: bold }); page.drawText(fit(value, font, size, w - 110), { x: x + 110, y, size, font }); y -= size + 5; };
  page.drawText('DANFE Simplificado - Etiqueta', { x, y, size: 14, font: bold }); y -= 20;
  page.drawText(safe(`Chave de acesso: ${groupChave(nfe.chave)}`), { x, y, size: 9, font }); y -= 6;
  if (/^\d{44}$/.test(nfe.chave)) {
    const modules = code128C(nfe.chave), total = modules.reduce((a, b) => a + b, 0) + 20, mw = Math.min(1.2, w / total);
    let bx = x + 10 * mw; const bh = 38; y -= bh;
    modules.forEach((m, i) => { if (i % 2 === 0) page.drawRectangle({ x: bx, y, width: m * mw, height: bh, color: rgb(0, 0, 0) }); bx += m * mw; });
    y -= 14;
  }
  const emissao = nfe.emissao ? new Date(nfe.emissao).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  line('NF-e', `Nº ${nfe.numero}  Série ${nfe.serie}  Emissão ${emissao}  Protocolo ${nfe.protocolo}`);
  line('Emitente', `${nfe.emitNome} - CNPJ ${nfe.emitCnpj}${nfe.emitIe ? ` - IE ${nfe.emitIe}` : ''} - ${nfe.emitCidade}/${nfe.emitUf}`);
  line('Destinatário', `${nfe.destNome}${maskCpf(nfe.destDoc) ? ` - ${maskCpf(nfe.destDoc)}` : ''}`);
  line('Endereço', nfe.destEndereco);
  line('Valor total', `${brl(nfe.valorTotal)}  ·  ${nfe.itens.reduce((s, i) => s + i.qtd, 0)} item(ns)`.replace('·', '-'));
  y -= 2; page.drawText('Itens', { x, y, size: 9, font: bold }); y -= 12;
  nfe.itens.slice(0, 8).forEach((i) => { page.drawText(fit(`${i.qtd}x  ${i.descricao}`, font, 8, w), { x, y, size: 8, font }); y -= 11; });
  if (nfe.itens.length > 8) { page.drawText(safe(`+${nfe.itens.length - 8} itens`), { x, y, size: 8, font: bold }); y -= 11; }
  page.drawText('Consulta pela chave de acesso em www.nfe.fazenda.gov.br/portal', { x, y: Math.max(y - 4, 24), size: 8, font });
}
/** True when the label page is ~A4/Letter size (would become unreadable if shrunk to half a page). */
export function isFullPageLabel(w: number, h: number) { const [a, b] = [Math.min(w, h), Math.max(w, h)]; return a >= 500 && b >= 760; }
export async function buildCombinedPdf(labelPdf: Uint8Array, nfes: NfeSummary[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [label] = await doc.embedPdf(labelPdf, [0]);
  const half = A4.h / 2;
  // Full-page (A4-like) label: keep it whole on page 1 and print each DANFE on its own page.
  if (isFullPageLabel(label.width, label.height)) {
    const first = doc.addPage([A4.w, A4.h]);
    const scale = Math.min(A4.w / label.width, A4.h / label.height);
    first.drawPage(label, { x: (A4.w - label.width * scale) / 2, y: (A4.h - label.height * scale) / 2, width: label.width * scale, height: label.height * scale });
    nfes.forEach((nfe) => drawDanfe(doc.addPage([A4.w, A4.h]), nfe, font, bold, A4.h - 20));
    return await doc.save();
  }
  (nfes.length ? nfes : [null]).forEach((nfe, idx) => {
    const page = doc.addPage([A4.w, A4.h]);
    if (idx === 0) {
      const maxW = A4.w - 30, maxH = half - 20, scale = Math.min(maxW / label.width, maxH / label.height);
      const lw = label.width * scale, lh = label.height * scale;
      page.drawPage(label, { x: (A4.w - lw) / 2, y: half + 10 + (maxH - lh) / 2, width: lw, height: lh });
    } else page.drawText(safe(`NF-e adicional do mesmo envio (${idx + 1}/${nfes.length})`), { x: 30, y: A4.h - 40, size: 11, font: bold });
    page.drawLine({ start: { x: 10, y: half }, end: { x: A4.w - 10, y: half }, thickness: 0.8, dashArray: [6, 4], color: rgb(0.3, 0.3, 0.3) });
    page.drawText('corte aqui', { x: A4.w - 60, y: half + 3, size: 6, font, color: rgb(0.4, 0.4, 0.4) });
    if (nfe) drawDanfe(page, nfe, font, bold, half - 10);
  });
  return await doc.save();
}
export async function concatPdfs(files: Uint8Array[]) {
  const doc = await PDFDocument.create();
  for (const f of files) { const src = await PDFDocument.load(f); (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p)); }
  return await doc.save();
}

/** Preserve official vector artwork; never rasterize or stretch barcodes. */
export async function buildThermalLabel(labelPdf: Uint8Array) {
  const source = await PDFDocument.load(labelPdf);
  const doc = await PDFDocument.create();
  for (const src of source.getPages()) {
    const crop = src.getCropBox();
    // A4 documents must carry a 100x150 CropBox. Guessing a corner could cut a barcode.
    const isThermal = Math.abs(crop.width - THERMAL.w) < 3 && Math.abs(crop.height - THERMAL.h) < 3;
    if (!isThermal) throw new Error('Rótulo fora de 100 × 150 mm e sem recorte seguro. Reemita o rótulo no layout LINEAR_100_150.');
    const embedded = await doc.embedPage(src, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
    const page = doc.addPage([THERMAL.w, THERMAL.h]);
    const scale = Math.min(THERMAL.w / crop.width, THERMAL.h / crop.height);
    page.drawPage(embedded, { x: 0, y: THERMAL.h - crop.height * scale, width: crop.width * scale, height: crop.height * scale });
  }
  return doc.save();
}

function drawThermalDanfe(page: PDFPage, n: NfeSummary, font: PDFFont, bold: PDFFont) {
  const x = 10, w = THERMAL.w - 20; let y = THERMAL.h - 16;
  const text = (s: string, size = 7, strong = false) => { page.drawText(safe(s), { x, y, size, font: strong ? bold : font, color: rgb(0, 0, 0) }); y -= size + 3; };
  const wrap = (s: string, maxLines = 2, strong = false) => {
    const words = safe(s).split(/\s+/); let row = '', lines = 0;
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (font.widthOfTextAtSize(next, 7) > w && row) {
        text(row, 7, strong); lines++; row = word;
        if (lines >= maxLines - 1) break;
      } else row = next;
    }
    // Long final line is explicitly truncated instead of shrinking below 7pt.
    const consumed = words.slice(0, words.indexOf(row.split(' ')[0])).join(' ');
    if (lines >= maxLines - 1) {
      const remaining = safe(s).slice(consumed.length).trim();
      text(fit(remaining || row, font, 7, w), 7, strong);
    } else if (row) text(fit(row, font, 7, w), 7, strong);
  };
  text('DANFE Simplificado - Etiqueta', 10, true);
  text('CHAVE DE ACESSO', 7, true);
  const key = n.chave.match(/.{1,22}/g) || [n.chave];
  key.forEach((row) => text(row, 8));
  if (/^\d{44}$/.test(n.chave)) {
    const modules = code128C(n.chave), total = modules.reduce((a, b) => a + b, 0);
    // 0.85 pt/module = ~2.4 printer dots at 203dpi, bars >70 mm + quiet zones.
    const mw = 0.85, bh = 36; let bx = x + 10 * mw; y -= bh;
    modules.forEach((m, i) => { if (i % 2 === 0) page.drawRectangle({ x: bx, y, width: m * mw, height: bh, color: rgb(0, 0, 0) }); bx += m * mw; });
    if (total * mw < 70 * 72 / 25.4) throw new Error('Código de barras da NF-e menor que 70 mm');
    y -= 12;
  }
  const date = n.emissao ? new Date(n.emissao).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  text(`NF-e ${n.numero} / Série ${n.serie} / ${date}`, 8, true);
  text(`Protocolo: ${n.protocolo}`);
  text('EMITENTE', 7, true); wrap(n.emitNome);
  text(`CNPJ ${n.emitCnpj}${n.emitIe ? ` / IE ${n.emitIe}` : ''}`);
  text(`${n.emitCidade}/${n.emitUf}`);
  text('DESTINATÁRIO', 7, true); wrap(n.destNome);
  if (maskCpf(n.destDoc)) text(maskCpf(n.destDoc));
  wrap(n.destEndereco, 3);
  text(`TOTAL ${brl(n.valorTotal)} / ${n.itens.reduce((s, i) => s + i.qtd, 0)} item(ns)`, 8, true);
  text('ITENS', 7, true);
  n.itens.slice(0, 6).forEach((i) => text(fit(`${i.qtd}x ${i.descricao}`, font, 7, w)));
  if (n.itens.length > 6) text(`+${n.itens.length - 6} itens`, 7, true);
  page.drawText('Consulta pela chave de acesso em', { x, y: 20, size: 7, font, color: rgb(0, 0, 0) });
  page.drawText('www.nfe.fazenda.gov.br/portal', { x, y: 10, size: 7, font, color: rgb(0, 0, 0) });
}

export async function buildLabelFormats(labelPdf: Uint8Array, nfes: NfeSummary[]) {
  if (!nfes.length) throw new Error('XML da NF-e do envio não encontrado para gerar a DANFE');
  const thermalLabel = await buildThermalLabel(labelPdf);
  const doc = await PDFDocument.load(thermalLabel);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  nfes.forEach((n) => drawThermalDanfe(doc.addPage([THERMAL.w, THERMAL.h]), n, font, bold));
  const thermal = await doc.save();
  const a4 = await buildCombinedPdf(thermalLabel, nfes);
  return { thermal, thermalLabel, a4 };
}
