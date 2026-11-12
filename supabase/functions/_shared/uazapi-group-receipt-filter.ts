type AnyObj = Record<string, unknown>;

const GROUP_RECEIPT_TARGETS = [
  {
    id: '0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c',
    owners: new Set(['553391208852', '5533991208852']),
    reason: 'group_receipts_disabled_perola',
  },
  {
    id: 'fb7dd381-6460-4f28-8d01-f15943edb879',
    owners: new Set(['553387283243', '5533987283243']),
    reason: 'group_receipts_disabled_carol',
  },
];

/**
 * GroupReceipts chega dentro de messages_update. O filtro isGroupYes da uazapi
 * também cortaria mensagens de grupo usadas pelo acompanhamento dos grupos VIP,
 * por isso o descarte precisa ser seletivo aqui, antes das consultas de status.
 */
export function groupReceiptSkipReason(payload: AnyObj, numberId: string | null): string | null {
  const eventType = String(payload.EventType || payload.event || '').toLowerCase();
  if (eventType !== 'messages_update' && eventType !== 'message_update') return null;
  const event = payload.event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (String((event as AnyObj).Type || '').toLowerCase() !== 'groupreceipts') return null;
  const owner = String(payload.owner || '').replace(/\D/g, '');
  const target = GROUP_RECEIPT_TARGETS.find((item) => item.id === numberId || item.owners.has(owner));
  return target?.reason || null;
}
