// Own 100x150 mm Correios label (ERP), reproducing the official blocks with larger fonts
// plus the NF-e band. The DataMatrix payload is copied verbatim from the official label,
// because it carries a Correios-generated token that cannot be recomputed locally.
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFNumber, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import bwipjs from 'npm:bwip-js@4.5.1';
import { readBarcodes } from 'npm:zxing-wasm@2.2.4/reader';
import { groupChave, type NfeSummary } from './correios-prepost-domain.ts';

const MM = 72 / 25.4;
export const LABEL = { w: 100 * MM, h: 150 * MM };
const A4 = { w: 595.28, h: 841.89 };
const BLACK = rgb(0, 0, 0);
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
export const safe = (s: unknown) => String(s ?? '').normalize('NFC').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, (c) => c.normalize('NFD').replace(/[^\x20-\x7E]/g, '') || '');

/** Validator digit used by Correios for the destination CEP. */
export function cepValidator(cep: string) { const s = digits(cep).split('').reduce((a, d) => a + Number(d), 0); return (10 - (s % 10)) % 10; }
const POSTNET = ['11000', '00011', '00101', '00110', '01001', '01010', '01100', '10001', '10010', '10100'];
/** CEPNet bits (1 = long bar) including frame bars and check digit. */
export function cepnetBits(cep: string) { const d = digits(cep); return '1' + (d + cepValidator(d)).split('').map((x) => POSTNET[Number(x)]).join('') + '1'; }

/** Official DataMatrix layout as decoded from a real label (IDV 59). */
export function parseDataMatrix(s: string) {
  return { cepDestino: s.slice(0, 8), complementoDestino: s.slice(8, 13), cepOrigem: s.slice(13, 21), complementoOrigem: s.slice(21, 26), validador: s.slice(26, 27), idv: s.slice(27, 29), objeto: s.slice(29, 42), restante: s.slice(42) };
}
/** Guards that a copied payload belongs to this shipment before printing it on our label. */
export function dataMatrixProblems(s: string, x: { objeto: string; cepDestino: string; cepOrigem: string }) {
  const p = parseDataMatrix(s), out: string[] = [];
  if (p.objeto !== x.objeto) out.push('objeto');
  if (p.cepDestino !== digits(x.cepDestino)) out.push('CEP destino');
  if (p.cepOrigem !== digits(x.cepOrigem)) out.push('CEP origem');
  if (p.validador !== String(cepValidator(x.cepDestino))) out.push('validador do CEP');
  if (!s.endsWith('|')) out.push('terminador');
  return out;
}

async function inflate(bytes: Uint8Array) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Reads the DataMatrix from the official label's 1-bit images (the label embeds it as a bitmap). */
export async function readOfficialDataMatrix(labelPdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(labelPdf);
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(PDFName.of('Subtype'))?.toString() !== '/Image' || d.get(PDFName.of('BitsPerComponent'))?.toString() !== '1') continue;
    if (d.get(PDFName.of('Filter'))?.toString() !== '/FlateDecode') continue;
    const w = (d.get(PDFName.of('Width')) as PDFNumber).asNumber(), h = (d.get(PDFName.of('Height')) as PDFNumber).asNumber();
    if (Math.abs(w - h) > 2) continue; // DataMatrix is square; skip linear barcodes
    const dec = d.get(PDFName.of('Decode')) as PDFArray | undefined;
    const inverted = dec ? (dec.get(0) as PDFNumber).asNumber() === 1 : false;
    const raw = await inflate(obj.contents), row = Math.ceil(w / 8), S = 4, pad = 16, W = w * S + pad * 2, H = h * S + pad * 2;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = (raw[y * row + (x >> 3)] >> (7 - (x & 7))) & 1;
      if ((bit === 0) !== inverted) for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const i = ((pad + y * S + dy) * W + pad + x * S + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
    }
    const res = await readBarcodes({ data, width: W, height: H, colorSpace: 'srgb' } as unknown as ImageData, { formats: ['DataMatrix'], tryHarder: true });
    const text = res.find((r) => r.isValid)?.text;
    if (text) return text;
  }
  throw new Error('Não foi possível ler o código DataMatrix do rótulo oficial');
}

function drawMatrix(page: PDFPage, text: string, x: number, top: number, module: number) {
  const [m] = (bwipjs as any).raw('datamatrix', text, {});
  for (let r = 0; r < m.pixy; r++) for (let c = 0; c < m.pixx; c++) if (m.pixs[r * m.pixx + c]) page.drawRectangle({ x: x + c * module, y: top - (r + 1) * module, width: module, height: module, color: BLACK });
  return { size: m.pixx * module, modules: m.pixx };
}
/** Draws a linear barcode centered on cx; returns its width (bars only). */
function drawLinear(page: PDFPage, bcid: 'code128', text: string, cx: number, bottom: number, height: number, module: number, opts: Record<string, unknown> = {}) {
  const [b] = (bwipjs as any).raw(bcid, text, opts);
  const width = (b.sbs as number[]).reduce((a, n) => a + n, 0) * module;
  let x = cx - width / 2;
  (b.sbs as number[]).forEach((n, i) => { if (i % 2 === 0) page.drawRectangle({ x, y: bottom, width: n * module, height, color: BLACK }); x += n * module; });
  return { width, left: cx - width / 2 };
}
export function linearModules(text: string, opts: Record<string, unknown> = {}) { const [b] = (bwipjs as any).raw('code128', text, opts); return (b.sbs as number[]).reduce((a, n) => a + n, 0); }

export interface OwnLabelData {
  dataMatrix: string; objeto: string; servico: string; contrato: string; cartao: string; pesoG: number; volume?: string; reference?: string;
  dest: { nome: string; logradouro: string; numero: string; complemento?: string; bairro: string; cep: string; cidade: string; uf: string };
  rem: { nome: string; logradouro: string; numero: string; complemento?: string; bairro: string; cep: string; cidade: string; uf: string; cnpj: string; telefone?: string };
  nfes: NfeSummary[];
}
const fmtCep = (c: string) => digits(c).replace(/^(\d{5})(\d{3})$/, '$1-$2');
const fmtCnpj = (c: string) => digits(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtObj = (o: string) => o.replace(/^([A-Z]{2})(\d{3})(\d{3})(\d{3})([A-Z]{2})$/, '$1 $2 $3 $4 $5');
const fmtPhone = (p?: string) => { const d = digits(p); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };

/** Smallest font size actually used, recorded for validation. */
export const MIN_FONT = 7.5;
function wrap(text: string, font: PDFFont, size: number, max: number, lines: number) {
  const words = safe(text).split(/\s+/).filter(Boolean), out: string[] = []; let row = '';
  for (const w of words) { const next = row ? `${row} ${w}` : w; if (font.widthOfTextAtSize(next, size) > max && row) { out.push(row); row = w; } else row = next; }
  if (row) out.push(row);
  return out.length <= lines ? out : null;
}
/** Wraps at the requested size, shrinking down to `min` only when the text does not fit. */
function fitLines(text: string, font: PDFFont, size: number, min: number, max: number, lines: number) {
  for (let s = size; s >= min; s -= 0.5) { const r = wrap(text, font, s, max, lines); if (r) return { lines: r, size: s }; }
  const r = wrap(text, font, min, max, 99) || [safe(text)];
  const kept = r.slice(0, lines); let last = kept[lines - 1] || '';
  while (last && font.widthOfTextAtSize(`${last}...`, min) > max) last = last.slice(0, -1);
  if (r.length > lines) kept[lines - 1] = `${last}...`;
  return { lines: kept, size: min };
}

function drawNfeBand(page: PDFPage, n: NfeSummary, bold: PDFFont, font: PDFFont, topMm: number) {
  const y = (mm: number) => LABEL.h - mm * MM;
  page.drawText(safe(`NF-e nº ${n.numero}  Série ${n.serie}`), { x: 4 * MM, y: y(topMm + 3.2), size: 8, font: bold, color: BLACK });
  if (/^\d{44}$/.test(n.chave)) drawLinear(page, 'code128', n.chave, LABEL.w / 2, y(topMm + 17.8), 14 * MM, 0.3 * MM);
  const key = groupChave(n.chave);
  const kw = font.widthOfTextAtSize(key, 7.5);
  page.drawText(key, { x: (LABEL.w - kw) / 2, y: y(topMm + 20.9), size: 7.5, font, color: BLACK });
}

export async function buildOwnLabel(d: OwnLabelData) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([LABEL.w, LABEL.h]);
  const y = (mm: number) => LABEL.h - mm * MM; // top-down millimetres
  const X = (mm: number) => mm * MM;
  const text = (s: string, xMm: number, yMm: number, size: number, f: PDFFont = font) => page.drawText(safe(s), { x: X(xMm), y: y(yMm), size, font: f, color: BLACK });
  const hline = (yMm: number, x1 = 3, x2 = 97, t = 0.6) => page.drawLine({ start: { x: X(x1), y: y(yMm) }, end: { x: X(x2), y: y(yMm) }, thickness: t, color: BLACK });

  // 1. CABEÇALHO: DataMatrix (0.5 mm = 4 dots @203dpi), service and contract.
  const dm = drawMatrix(page, d.dataMatrix, X(6), y(6), 0.5 * MM);
  const right = 6 + dm.size / MM + 6;
  text(d.servico, right, 13, 18, bold);
  text(`Contrato ${d.contrato}`, right, 18.5, 8);
  text(`Cartão ${d.cartao}`, right, 22, 8);
  text(`${(d.pesoG / 1000).toFixed(3).replace('.', ',')} kg${d.volume ? `  ·  Vol. ${d.volume}` : ''}`.replace('·', '-'), right, 26, 9, bold);
  // Object Code128: 0.5 mm modules (4 dots); falls back to 0.375 mm if it would exceed 88 mm.
  const objModule = linearModules(d.objeto) * 0.5 <= 88 ? 0.5 : 0.375;
  drawLinear(page, 'code128', d.objeto, LABEL.w / 2, y(45), 14 * MM, objModule * MM);
  const human = fmtObj(d.objeto); const hw = bold.widthOfTextAtSize(human, 12);
  page.drawText(human, { x: (LABEL.w - hw) / 2, y: y(50), size: 12, font: bold, color: BLACK });

  // 2. RECEBEDOR
  hline(52);
  text('Recebedor:', 4, 57.5, 9, bold); hline(58, 25, 96, 0.5);
  text('Assinatura:', 4, 65, 9, bold); hline(65.5, 25, 56, 0.5);
  text('Documento:', 58, 65, 9, bold); hline(65.5, 77, 96, 0.5);
  hline(67.5, 3, 97, 1);

  // 3. DESTINATÁRIO
  page.drawRectangle({ x: X(3), y: y(73), width: X(29), height: X(4.8), color: BLACK });
  page.drawText('DESTINATÁRIO', { x: X(4.2), y: y(71.8), size: 9, font: bold, color: rgb(1, 1, 1) });
  const name = fitLines(d.dest.nome.toUpperCase(), bold, 12, 9, X(92), 1);
  text(name.lines[0], 4, 78.5, name.size, bold);
  const street = [`${d.dest.logradouro}, ${d.dest.numero}`, d.dest.complemento].filter(Boolean).join(' - ');
  const addr = fitLines(street, font, 10, 9, X(92), 2);
  let cy = 83;
  addr.lines.forEach((l) => { text(l, 4, cy, addr.size); cy += addr.size * 0.3528 + 1.1; });
  const bairro = fitLines(d.dest.bairro, font, 10, 9, X(92), 1);
  text(bairro.lines[0], 4, cy, bairro.size); cy += 4.9;
  text(`CEP ${fmtCep(d.dest.cep)}  ${d.dest.cidade}/${d.dest.uf}`, 4, cy, 11, bold);
  // CEP barcode as in the official label (Code128C of the 8 digits), 6 mm quiet zone on the left.
  const cepModule = 0.5;
  const cepW = linearModules(digits(d.dest.cep)) * cepModule;
  drawLinear(page, 'code128', digits(d.dest.cep), X(6 + cepW / 2), y(106.5), 10 * MM, cepModule * MM);
  if (d.reference) text(`Pedido ${d.reference}`, 6 + cepW + 8, 102, 9);
  hline(108.5, 3, 97, 1);

  // 4. REMETENTE
  text('REMETENTE', 4, 112, 8, bold);
  text(d.rem.nome, 4, 115.8, 9, bold);
  const rs = fitLines([`${d.rem.logradouro}, ${d.rem.numero}`, d.rem.complemento, d.rem.bairro].filter(Boolean).join(' - '), font, 8, 7.5, X(92), 1);
  text(rs.lines[0], 4, 119.3, rs.size);
  text(`CEP ${fmtCep(d.rem.cep)}  ${d.rem.cidade}/${d.rem.uf}`, 4, 122.6, 8);
  text(`CNPJ ${fmtCnpj(d.rem.cnpj)}${d.rem.telefone ? `   Tel. ${fmtPhone(d.rem.telefone)}` : ''}`, 4, 125.9, 8);

  // 5. NF-e band (main invoice); extra invoices go to a second label with bands only.
  hline(127.5, 3, 97, 0.5);
  if (d.nfes[0]) drawNfeBand(page, d.nfes[0], bold, font, 127.5);
  const rest = d.nfes.slice(1);
  for (let i = 0; i < rest.length; i += 5) {
    const p = doc.addPage([LABEL.w, LABEL.h]);
    p.drawText(safe(`Objeto ${fmtObj(d.objeto)} - NF-e adicionais`), { x: X(4), y: LABEL.h - X(7), size: 9, font: bold, color: BLACK });
    rest.slice(i, i + 5).forEach((n, k) => drawNfeBand(p, n, bold, font, 10 + k * 27));
  }
  return await doc.save();
}

/** Places own 100x150 labels at real size, two per A4 sheet with a cut line. */
export async function ownLabelsToA4(files: Uint8Array[]) {
  const doc = await PDFDocument.create();
  const pages: Awaited<ReturnType<typeof doc.embedPdf>> = [];
  for (const f of files) { const src = await PDFDocument.load(f); pages.push(...await doc.embedPdf(f, src.getPageIndices())); }
  const top = A4.h - 15 * MM - LABEL.h, left = (A4.w - 2 * LABEL.w) / 2;
  for (let i = 0; i < pages.length; i += 2) {
    const sheet = doc.addPage([A4.w, A4.h]);
    pages.slice(i, i + 2).forEach((p, k) => sheet.drawPage(p, { x: left + k * LABEL.w, y: top, width: LABEL.w, height: LABEL.h }));
    const cut = { color: BLACK, thickness: 0.4, dashArray: [4, 3] };
    sheet.drawLine({ start: { x: A4.w / 2, y: top - 8 }, end: { x: A4.w / 2, y: top + LABEL.h + 8 }, ...cut });
    sheet.drawRectangle({ x: left, y: top, width: 2 * LABEL.w, height: LABEL.h, borderColor: BLACK, borderWidth: 0.4, borderDashArray: [4, 3] });
  }
  return await doc.save();
}
