import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  fetchFrenetPublicEvents,
  isJadlogTrackingSource,
  normalizeJadlogLocation,
  parseFrenetPublicTrackingHtml,
} from './frenet-tracking.ts';
import { classifyDeliveryEvent } from './delivery-event.ts';
import { translateRealEvent } from './shipment-stages.ts';
import { shouldShowOriginEvent } from './shipment-origin-event.ts';

// Exemplo real da página pública, sem nome, endereço ou qualquer dado do cliente.
const REAL_JADLOG_HTML = `
<div class="tracking-result-timeline">
  <div class="tracking-item"><div class="title"><i class="marker"></i> ENTREGUE</div><div class="details">09/10/2026 16:03:12 - CO BELO HORIZONTE</div></div>
  <div class="tracking-item"><div class="title"><i class="marker"></i> EM ROTA</div><div class="details">09/10/2026 09:51:35 - CO BELO HORIZONTE</div></div>
  <div class="tracking-item"><div class="title"><i class="marker"></i> TRANSFERIDO PARA UNIDADE</div><div class="details">08/10/2026 07:11:37 - MT JADLOG SEDE</div></div>
  <div class="tracking-item"><div class="title"><i class="marker"></i> ENTRADA</div><div class="details">07/10/2026 13:47:39 - FL BELO HORIZONTE</div></div>
  <div class="tracking-item"><div class="title"><i class="marker"></i> EMISSAO</div><div class="details">02/10/2026 17:58:23 - CO GOV VALADARES 01</div></div>
  <div class="tracking-item"><div class="title"><i class="marker"></i> FASE DE COLETA</div><div class="details">01/10/2026 15:49:28 - CO GOV VALADARES 01</div></div>
</div>`;

Deno.test('Jadlog pública: converte HTML real em eventos cronológicos e horário de Brasília', () => {
  const events = parseFrenetPublicTrackingHtml(REAL_JADLOG_HTML);
  assertEquals(events.length, 6);
  assertEquals(events[0], {
    at: '2026-10-01T18:49:28.000Z',
    description: 'FASE DE COLETA',
    location: 'Governador Valadares',
    type: 'JADLOG',
  });
  assertEquals(events.at(-1), {
    at: '2026-10-09T19:03:12.000Z',
    description: 'ENTREGUE',
    location: 'BELO HORIZONTE',
    type: 'JADLOG',
  });
});

Deno.test('Jadlog pública: unidade de Valadares é reconhecida e sede não expõe transportadora', () => {
  assertEquals(normalizeJadlogLocation('CO GOV VALADARES 01'), 'Governador Valadares');
  assertEquals(normalizeJadlogLocation('MT JADLOG SEDE'), '');
  assertEquals(normalizeJadlogLocation('CO ARACAJU'), 'ARACAJU');
});

Deno.test('Jadlog: ENTREGUE confirma entrega; coleta e emissão não contam como postagem', () => {
  assertEquals(classifyDeliveryEvent({ description: 'ENTREGUE', type: 'JADLOG' }, 'Jadlog'), 'delivered');
  for (const description of ['FASE DE COLETA', 'EMISSAO']) {
    const translated = translateRealEvent(description, 'carrier', { type: 'JADLOG' });
    assertEquals(classifyDeliveryEvent({ description, type: 'JADLOG' }, 'Jadlog'), null);
    assertEquals(translated?.title, 'Pedido em trânsito');
    assertEquals(shouldShowOriginEvent(description, 'JADLOG', translated!.title, false), false);
  }
});

Deno.test('Jadlog: ENTRADA, TRANSFERÊNCIA, EM ROTA e ENTREGUE têm tradução própria', () => {
  assertEquals(translateRealEvent('ENTRADA', 'carrier')?.title, 'Pedido em trânsito');
  assertEquals(translateRealEvent('TRANSFERIDO PARA UNIDADE', 'carrier'), {
    title: 'Pedido em trânsito', detail: 'Seu pedido está a caminho da sua cidade.',
  });
  assertEquals(translateRealEvent('EM ROTA', 'carrier'), {
    title: 'Saiu para entrega', detail: 'Seu pedido está com o entregador.',
  });
  assertEquals(translateRealEvent('ENTREGUE', 'carrier'), {
    title: 'Pedido entregue', detail: 'Seu pedido foi entregue.', terminal: true,
  });
});

Deno.test('Reserva pública é exclusiva da Jadlog', () => {
  assertEquals(isJadlogTrackingSource('Jadlog'), true);
  assertEquals(isJadlogTrackingSource(null, 'https://rastreio.frenet.com.br/JAD/123456789'), true);
  assertEquals(isJadlogTrackingSource('Correios', 'https://rastreio.frenet.com.br/COR/AB123456789BR'), false);
});

Deno.test('Reserva pública devolve F_3 e falha da página nunca quebra o rastreio', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve(new Response(REAL_JADLOG_HTML, { status: 200 }));
    const found = await fetchFrenetPublicEvents('JAD', '625169886');
    assertEquals(found?.serviceCode, 'F_3');
    assertEquals(found?.events.length, 6);

    globalThis.fetch = () => Promise.reject(new Error('página indisponível'));
    assertEquals(await fetchFrenetPublicEvents('JAD', '625169886'), null);
    assertEquals(await fetchFrenetPublicEvents('COR', 'AB123456789BR'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
