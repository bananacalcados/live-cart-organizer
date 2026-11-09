import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { publicDeliveryEstimate } from './delivery-estimate-public.ts';

const estimate = { kind: 'confirmed', start: '2026-11-10', end: '2026-11-13' };

Deno.test('Previsão: envio ainda não entregue mantém a faixa de datas', () => {
  assertEquals(publicDeliveryEstimate(estimate, null), estimate);
});

Deno.test('Previsão: entrega confirmada nunca mostra estimativa nem previsão real', () => {
  assertEquals(publicDeliveryEstimate(estimate, '2026-11-09T15:00:00Z'), null);
  assertEquals(publicDeliveryEstimate({ ...estimate, kind: 'estimated' }, '2026-11-09T15:00:00Z'), null);
});
