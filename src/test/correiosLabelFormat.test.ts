import { describe, it, expect } from 'vitest';
import { normalizeCorreiosLabelFormat, correiosLabelUrl } from '@/lib/correiosLabelFormat';

describe('formato de impressão Correios', () => {
  it('padrão é a etiqueta 10×15 do ERP', () => {
    expect(normalizeCorreiosLabelFormat(null)).toBe('propria_10x15');
    expect(normalizeCorreiosLabelFormat('10x15')).toBe('propria_10x15');
  });
  it('escolhas antigas viram os formatos oficiais', () => {
    expect(normalizeCorreiosLabelFormat('label10x15')).toBe('oficial_10x15');
    expect(normalizeCorreiosLabelFormat('a4')).toBe('oficial_a4');
  });
  it('rótulo oficial abre o PDF da API, não o do ERP', () => {
    const s = { own_url: 'erp', thermal_label_url: 'oficial', a4_url: 'a4', own_a4_url: 'erpa4' };
    expect(correiosLabelUrl(s, 'oficial_10x15')).toBe('oficial');
    expect(correiosLabelUrl(s, 'propria_a4')).toBe('erpa4');
  });
});
