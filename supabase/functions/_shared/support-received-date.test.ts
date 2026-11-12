import { assertEquals } from 'jsr:@std/assert';
import { customerReceiptFromConversation } from './support-received-date.ts';

const shipped = '2026-11-04T17:03:07Z';
const conv = (text: string, at = '2026-11-12T19:03:17Z') => [{ from: 'cliente' as const, text, at }];

Deno.test('data explícita com barra invertida usada pela Arlete', () => {
  assertEquals(customerReceiptFromConversation(conv('Recebi ontem 11\\11\\26'), shipped), { date: '2026-11-11', claimed: true, messageAt: '2026-11-12T19:03:17Z' });
});
Deno.test('aceita data completa, pontos e hoje/ontem', () => {
  assertEquals(customerReceiptFromConversation(conv('O pedido chegou em 09.11.2026'), shipped).date, '2026-11-09');
  assertEquals(customerReceiptFromConversation(conv('Recebi hoje'), shipped).date, '2026-11-12');
  assertEquals(customerReceiptFromConversation(conv('Recebi ontem'), shipped).date, '2026-11-11');
});
Deno.test('não usa mensagem da loja, antes do envio nem negativa de recebimento', () => {
  assertEquals(customerReceiptFromConversation([{ from: 'loja', text: 'Recebeu em 11/11/26?', at: '2026-11-12T19:03:17Z' }], shipped).claimed, false);
  assertEquals(customerReceiptFromConversation(conv('Recebi em 11/11/26', '2026-11-01T10:00:00Z'), shipped).claimed, false);
  assertEquals(customerReceiptFromConversation(conv('Ainda não recebi, era para chegar 11/11/26'), shipped).date, null);
});
Deno.test('data impossível não é inventada', () => {
  assertEquals(customerReceiptFromConversation(conv('Recebi em 31/02/26'), shipped).date, null);
});
