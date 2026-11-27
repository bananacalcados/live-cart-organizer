import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { publicRealTrackingEvents, shouldShowOriginEvent } from '../_shared/shipment-origin-event.ts';

const now = new Date('2026-11-27T19:35:00Z');
const sentAt = Date.parse('2026-11-26T12:00:00Z');
const build = (events: Parameters<typeof publicRealTrackingEvents>[0]) =>
  publicRealTrackingEvents(events, 'Governador Valadares', 'carrier', sentAt, now);

Deno.test('Origem Correios: etiqueta/coleta/postagem ocultas, RO e DO mostram só uma saída sem cidade', () => {
  const location = 'GOVERNADOR VALADARES/MG';
  const events = [
    { description: 'Etiqueta emitida', type: 'PRE', at: '2026-11-25T09:00:00Z', location },
    { description: 'Objeto coletado', type: 'CO', at: '2026-11-25T10:00:00Z', location },
    { description: 'Objeto postado', type: 'PO', at: '2026-11-25T11:00:00Z', location },
    { description: 'Objeto postado após o horário limite', type: 'PO', at: '2026-11-25T12:00:00Z', location },
    { description: 'Objeto em transferência', type: 'RO', at: '2026-11-25T13:00:00Z', location },
    { description: 'Objeto em transferência', type: 'DO', at: '2026-11-25T13:00:00Z', location },
    { description: 'Objeto em transferência', type: 'RO', at: '2026-11-26T13:00:00Z', location },
  ];
  assertEquals(build(events), [{
    title: 'Pedido em trânsito',
    detail: 'Seu pedido está a caminho da sua cidade.',
    at: '2026-11-26T12:01:00.000Z',
  }]);
});

Deno.test('Origem J&T: Saída da encomenda aparece sem expor GVR', () => {
  assertEquals(build([{
    description: '[Governador Valadares] Saída da encomenda expressa [GVR -MG]',
    location: 'Governador Valadares/MG',
    at: '2026-11-26T14:00:00Z',
  }]), [{
    title: 'Pedido em trânsito',
    detail: 'Seu pedido está a caminho da sua cidade.',
    at: '2026-11-26T14:00:00.000Z',
  }]);
});

Deno.test('Fora da origem: tradução, cidade, estado e horário permanecem iguais', () => {
  assertEquals(build([{
    description: 'Objeto em transferência', type: 'RO', location: 'BELO HORIZONTE/MG',
    at: '2026-11-26T14:00:00Z',
  }]), [{
    title: 'Pedido em trânsito', detail: 'Seu pedido está a caminho da sua cidade.',
    city: 'BELO HORIZONTE', state: 'MG', at: '2026-11-26T14:00:00.000Z',
  }]);
});

Deno.test('Origem: seleciona a primeira saída cronológica mesmo com histórico fora de ordem', () => {
  const location = 'Governador Valadares/MG';
  assertEquals(build([
    { description: 'Objeto em transferência', location, at: '2026-11-26T16:00:00Z' },
    { description: 'Objeto encaminhado', location, at: '2026-11-26T14:00:00Z' },
  ])[0]?.at, '2026-11-26T14:00:00.000Z');
});

Deno.test('Origem: FC sempre oculto mesmo se mencionar transferência', () => {
  assertEquals(shouldShowOriginEvent('Objeto encaminhado em transferência', 'FC', 'Pedido em trânsito', false), false);
  assertEquals(shouldShowOriginEvent('Saiu para entrega', 'FC', 'Saiu para entrega', false), false);
});

Deno.test('Origem: outras movimentações em trânsito continuam ocultas', () => {
  for (const description of ['Recebido na unidade', 'Em fiscalização', 'Etiqueta emitida para transferência', 'Objeto coletado e encaminhado']) {
    assertEquals(shouldShowOriginEvent(description, 'RO', 'Pedido em trânsito', false), false);
  }
  assertEquals(shouldShowOriginEvent('Objeto em transferencia', 'RO', 'Pedido em trânsito', false), true);
});

Deno.test('Origem: saída para entrega e entrega preservam a lógica atual', () => {
  assertEquals(build([
    { description: 'Saiu para entrega', location: 'Governador Valadares/MG', at: '2026-11-26T14:00:00Z' },
    { description: 'Objeto entregue ao destinatário', type: 'BDE', status: '01', location: 'Governador Valadares/MG', at: '2026-11-26T15:00:00Z' },
  ]).map(({ title, city, state }) => ({ title, city, state })), [
    { title: 'Saiu para entrega', city: 'Governador Valadares', state: 'MG' },
    { title: 'Pedido entregue', city: 'Governador Valadares', state: 'MG' },
  ]);
});