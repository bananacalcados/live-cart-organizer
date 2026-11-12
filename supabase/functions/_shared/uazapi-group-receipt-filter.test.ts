import { assertEquals } from 'jsr:@std/assert';
import { groupReceiptSkipReason } from './uazapi-group-receipt-filter.ts';

const receipt = (owner: string, type = 'GroupReceipts') => ({
  EventType: 'messages_update',
  owner,
  event: { Type: type, MessageIDs: ['group-message'] },
});

Deno.test('descarta GroupReceipts da Pérola e da Carol pelo owner', () => {
  assertEquals(groupReceiptSkipReason(receipt('553391208852'), null), 'group_receipts_disabled_perola');
  assertEquals(groupReceiptSkipReason(receipt('553387283243'), null), 'group_receipts_disabled_carol');
  assertEquals(groupReceiptSkipReason(receipt('5533991208852'), null), 'group_receipts_disabled_perola');
});

Deno.test('reconhece a instância pelo número da URL quando owner falta', () => {
  assertEquals(groupReceiptSkipReason(receipt(''), 'fb7dd381-6460-4f28-8d01-f15943edb879'), 'group_receipts_disabled_carol');
});

Deno.test('não altera recibos de outras instâncias nem recibos individuais', () => {
  assertEquals(groupReceiptSkipReason(receipt('553391229191'), null), null);
  assertEquals(groupReceiptSkipReason(receipt('553391208852', 'Read'), null), null);
});

Deno.test('não altera mensagens nem eventos de membros dos grupos', () => {
  assertEquals(groupReceiptSkipReason({ EventType: 'messages', owner: '553391208852', event: { Type: 'GroupReceipts' } }, null), null);
  assertEquals(groupReceiptSkipReason({ EventType: 'groups', owner: '553391208852', event: { Type: 'GroupReceipts' } }, null), null);
});
