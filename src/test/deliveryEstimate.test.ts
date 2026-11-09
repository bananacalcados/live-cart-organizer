import { describe, expect, it } from 'vitest';
import {
  addLogisticsBusinessDays,
  buildDeliveryEstimate,
  isExplicitSedex,
  parseDeliveryDayRange,
  saoPauloDate,
} from '../../supabase/functions/shipment-delivery-estimate/delivery-estimate';

const quotedAt = '2026-11-09T12:00:00Z';

describe('previsão de entrega do rastreio', () => {
  it('acrescenta exatamente 3 dias úteis no limite da faixa comum', () => {
    const estimate = buildDeliveryEstimate({ base: '2026-11-06', deliveryDays: 5, sedex: false, quotedAt });
    expect(estimate).toMatchObject({ start: '2026-11-13', end: '2026-11-18', preparation_business_days: 3 });
  });

  it('não acrescenta os 3 dias úteis quando o pedido está marcado como SEDEX', () => {
    const estimate = buildDeliveryEstimate({ base: '2026-11-06', deliveryDays: 5, sedex: true, quotedAt });
    expect(estimate).toMatchObject({ start: '2026-11-13', end: '2026-11-13', preparation_business_days: 0 });
  });

  it('reconhece SEDEX somente pela marcação explícita, não por texto solto', () => {
    expect(isExplicitSedex({ is_sedex: true })).toBe(true);
    expect(isExplicitSedex({ shipping_type: 'sedex' })).toBe(true);
    expect(isExplicitSedex({ is_sedex: false, shipping_type: 'transportadora' })).toBe(false);
  });

  it('pula fim de semana no preparo e no trânsito', () => {
    const estimate = buildDeliveryEstimate({ base: '2026-11-06', deliveryDays: 1, sedex: false, quotedAt });
    expect(estimate).toMatchObject({ start: '2026-11-09', end: '2026-11-12' });
    expect(addLogisticsBusinessDays('2026-11-07', 0)).toBe('2026-11-09');
  });

  it('usa o calendário de São Paulo e evita mudar o dia por fuso', () => {
    expect(saoPauloDate('2026-11-10T02:30:00Z')).toBe('2026-11-09');
  });

  it('interpreta os prazos numéricos e as faixas já digitadas pela Expedição', () => {
    expect(parseDeliveryDayRange('7')).toEqual({ min: 7, max: 7 });
    expect(parseDeliveryDayRange('5-9')).toEqual({ min: 5, max: 9 });
    expect(parseDeliveryDayRange('6 a 10 dias')).toEqual({ min: 6, max: 10 });
    expect(parseDeliveryDayRange('9-5')).toBeNull();
    expect(parseDeliveryDayRange('em breve')).toBeNull();
  });

  it('não inventa previsão quando o prazo não é estruturado', () => {
    expect(buildDeliveryEstimate({ base: '2026-11-09', deliveryDays: 'a combinar', sedex: false, quotedAt })).toBeNull();
  });
});
