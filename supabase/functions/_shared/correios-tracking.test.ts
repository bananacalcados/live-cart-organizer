import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { correiosTrackingRequest, normalizeCorreiosEvents, parseCorreiosDate } from './correios-tracking.ts';

const CODE = 'AP696893710BR';

Deno.test('Rastro: converte movimentações reais sem inventar fuso ou local', () => {
  const events = normalizeCorreiosEvents({
    objetos: [{
      codObjeto: CODE,
      eventos: [{
        codigo: 'BDE',
        tipo: '01',
        dtHrCriado: '2026-11-04T14:35:20',
        descricao: 'Objeto entregue ao destinatário',
        unidade: { endereco: { cidade: 'Belo Horizonte', uf: 'MG' } },
      }],
    }],
  }, CODE);

  assertEquals(events, [{
    at: '2026-11-04T17:35:20.000Z',
    description: 'Objeto entregue ao destinatário',
    location: 'Belo Horizonte/MG',
    type: 'BDE',
  }]);
});

Deno.test('Rastro: não mistura outro objeto e ignora evento sem data válida', () => {
  assertEquals(normalizeCorreiosEvents({ objetos: [{ codObjeto: 'AA000000000BR', eventos: [] }] }, CODE), []);
  assertEquals(normalizeCorreiosEvents({
    codObjeto: CODE,
    eventos: [{ dtHrCriado: 'data inválida', descricao: 'Objeto encaminhado' }],
  }, CODE), []);
});

Deno.test('Rastro: preserva o fuso quando a API já o informa', () => {
  assertEquals(parseCorreiosDate('2026-11-04T14:35:20-03:00'), '2026-11-04T17:35:20.000Z');
  assertEquals(parseCorreiosDate('2026-11-04T17:35:20Z'), '2026-11-04T17:35:20.000Z');
  assertEquals(parseCorreiosDate(''), null);
});
