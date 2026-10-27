import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildLabelFormats, buildThermalLabel, concatPdfs, THERMAL } from '../../supabase/functions/_shared/correios-label-pdf';
import type { NfeSummary } from '../../supabase/functions/_shared/correios-prepost-domain';
const nfe: NfeSummary = { chave: '31261016941125000156550010000025561036850200', numero: '2556', serie: '1', emissao: '2026-10-27T10:00:00-03:00', protocolo: '131260000000001', emitNome: 'Banana Calçados', emitCnpj: '16941125000156', emitIe: '123', emitCidade: 'Governador Valadares', emitUf: 'MG', destNome: 'Maria de Teste', destDoc: '12345678909', destEndereco: 'Rua A, 10, Centro, São Paulo/SP - 01310100', valorTotal: 159.99, itens: [{ descricao: 'Tênis de teste', qtd: 1, valor: 159.99 }] };
async function label() { const d = await PDFDocument.create(); d.addPage([THERMAL.w, THERMAL.h]).drawText('Correios'); return d.save(); }
describe('Formatos Correios', () => {
  it('térmica tem exatamente 100×150 mm e uma DANFE por NF-e', async () => {
    const f = await buildLabelFormats(await label(), [nfe, { ...nfe, numero: '2557' }]);
    const d = await PDFDocument.load(f.thermal);
    expect(d.getPageCount()).toBe(3);
    for (const p of d.getPages()) { expect(p.getWidth() * 25.4 / 72).toBeCloseTo(100, 8); expect(p.getHeight() * 25.4 / 72).toBeCloseTo(150, 8); }
  });
  it('só rótulo não contém página adicional de DANFE e A4 mantém 210×297 mm', async () => {
    const f = await buildLabelFormats(await label(), [nfe]);
    expect((await PDFDocument.load(f.thermalLabel)).getPageCount()).toBe(1);
    const a4 = await PDFDocument.load(f.a4);
    expect(a4.getPageCount()).toBe(1);
    expect(a4.getPage(0).getWidth() * 25.4 / 72).toBeCloseTo(210, 1);
    expect(a4.getPage(0).getHeight() * 25.4 / 72).toBeCloseTo(297, 1);
  });
  it('lote concatena todas as páginas sem mudar 100×150 mm', async () => {
    const f = await buildLabelFormats(await label(), [nfe]);
    const d = await PDFDocument.load(await concatPdfs([f.thermal, f.thermal]));
    expect(d.getPageCount()).toBe(4);
    d.getPages().forEach((p) => expect(p.getSize()).toEqual({ width: THERMAL.w, height: THERMAL.h }));
  });
  it('recorta um A4 que tenha CropBox térmico sem distorcer o rótulo', async () => {
    const d = await PDFDocument.create(); const p = d.addPage([595.28, 841.89]); p.drawText('Correios'); p.setCropBox(0, 400, THERMAL.w, THERMAL.h);
    expect((await PDFDocument.load(await buildThermalLabel(await d.save()))).getPage(0).getWidth()).toBeCloseTo(THERMAL.w, 8);
  });
  it('não imprime A4 como térmica com recorte adivinhado', async () => {
    const d = await PDFDocument.create(); d.addPage([595.28, 841.89]);
    await expect(buildThermalLabel(await d.save())).rejects.toThrow('sem recorte seguro');
  });
});