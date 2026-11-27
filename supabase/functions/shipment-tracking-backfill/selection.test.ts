import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Exercita o trecho real da consulta sem importar o servidor, consultar dados ou enviar requisições.
const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
const start = source.indexOf('  const staleBefore =');
const end = source.indexOf('  const { data: rows, error } = await query;', start);
if (start < 0 || end < 0) throw new Error('Trecho de seleção não encontrado');
const select = new Function('sb', 'parsed', 'Date', source.slice(start, end) + '\nreturn query;');
const now = Date.parse('2026-11-27T19:43:00Z');

function selection(refresh: boolean) {
  const calls: { method: string; args: unknown[] }[] = [];
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['select', 'eq', 'is', 'not', 'gte', 'order', 'limit', 'or']) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  }
  class Clock extends Date { static override now() { return now; } }
  select({ from: () => query }, { data: { refresh, limit: 10 } }, Clock);
  return calls;
}

Deno.test('Backfill: fila ordenada por sincronização com nulos primeiro e criação como desempate', () => {
  assertEquals(selection(true).filter((c) => c.method === 'order'), [
    { method: 'order', args: ['last_real_sync', { ascending: true, nullsFirst: true }] },
    { method: 'order', args: ['created_at', { ascending: true }] },
  ]);
});

Deno.test('Backfill refresh: defasagem de três horas e janela de criação de 45 dias', () => {
  const calls = selection(true);
  assertEquals(calls.find((c) => c.method === 'or')?.args, [
    'last_real_sync.is.null,last_real_sync.lt.2026-11-27T16:43:00.000Z',
  ]);
  assertEquals(calls.find((c) => c.method === 'gte')?.args, [
    'created_at', '2026-10-13T19:43:00.000Z',
  ]);
  assertEquals(calls.find((c) => c.method === 'limit')?.args, [10]);
});

Deno.test('Backfill sem refresh: continua selecionando somente last_real_sync nulo', () => {
  const calls = selection(false);
  assertEquals(calls.some((c) => c.method === 'or'), false);
  assertEquals(calls.filter((c) => c.method === 'is' && c.args[0] === 'last_real_sync'), [
    { method: 'is', args: ['last_real_sync', null] },
  ]);
});