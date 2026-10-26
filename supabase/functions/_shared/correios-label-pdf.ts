import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import { code128C, groupChave, maskCpf, type NfeSummary } from './correios-prepost-domain.ts';
const A4 = { w: 595.28, h: 841.89 };
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
export async function buildCombinedPdf(labelPdf: Uint8Array, nfes: NfeSummary[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [label] = await doc.embedPdf(labelPdf, [0]);
  const half = A4.h / 2;
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
