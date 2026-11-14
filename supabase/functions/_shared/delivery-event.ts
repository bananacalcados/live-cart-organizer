// Classificação única de eventos de rastreio (Correios SRO, Frenet, J&T...).
// "Entregue" só com evento de entrega de verdade; insucesso nunca vira entrega.

export type DeliveryEventLike = { description?: string | null; type?: string | null; status?: string | null };
export type DeliveryClass = 'delivered' | 'failed_attempt' | 'awaiting_pickup' | 'returning' | null;

const fold = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Eventos finais de entrega dos Correios (BDE/BDI/BDR); status 01 = entregue ao destinatário.
const CORREIOS_FINAL = /^(BDE|BDI|BDR)$/i;
const CORREIOS_DELIVERED_STATUS = new Set(['01']);

const NOT_DELIVERED = /\bnao (foi )?entregue|nao foi possivel entregar|carteiro nao atendido|destinatario ausente|ausente|endereco (insuficiente|inexistente|incorreto|incompleto)|ultima tentativa|tentativa de entrega|recusad|mudou-se|destinatario desconhecido|insucesso de entrega|endereco incompleto|cliente ausente|nao procurado|nao retirado/;
const AWAITING_PICKUP = /aguardando retirada|disponivel para retirada|aguardando ser retirado|caixa postal/;
const RETURNING = /devolvido ao remetente|devolucao ao remetente|entregue ao remetente|em devolucao|retorno ao remetente/;
const DELIVERED_TEXT = /\bentregue\b|entrega (efetuada|realizada)|\bdelivered\b|o pacote foi assinado/;

const CARRIER_DELIVERY_PATTERNS: { carrier: RegExp; description: RegExp }[] = [
  { carrier: /^J&T/i, description: /^\s*(\[[^\]]*\]\s*)?o pacote foi assinado/i },
  { carrier: /^Transportadora/i, description: /^\s*entrega realizada/i },
];

export function classifyDeliveryEvent(ev: DeliveryEventLike, carrier?: string | null): DeliveryClass {
  const d = fold(ev.description);
  const type = String(ev.type ?? '').trim().toUpperCase();
  const status = String(ev.status ?? '').trim().padStart(2, '0');
  const hasStatus = String(ev.status ?? '').trim() !== '';

  if (RETURNING.test(d)) return 'returning';
  if (AWAITING_PICKUP.test(d)) return 'awaiting_pickup';
  if (NOT_DELIVERED.test(d)) return 'failed_attempt';

  if (CORREIOS_FINAL.test(type) && hasStatus) {
    return CORREIOS_DELIVERED_STATUS.has(status) ? 'delivered' : 'failed_attempt';
  }
  if (DELIVERED_TEXT.test(d)) return 'delivered';
  if (carrier && CARRIER_DELIVERY_PATTERNS.some((p) => p.carrier.test(carrier) && p.description.test(String(ev.description ?? '')))) {
    return 'delivered';
  }
  return null;
}

export const isRealDeliveryEvent = (ev: DeliveryEventLike, carrier?: string | null) =>
  classifyDeliveryEvent(ev, carrier) === 'delivered';

/** Última entrega real da lista (ordenada por data); tentativa frustrada nunca conta. */
export function findDeliveredEvent<T extends DeliveryEventLike>(events: T[], carrier?: string | null): T | null {
  return [...events].reverse().find((e) => isRealDeliveryEvent(e, carrier)) ?? null;
}
