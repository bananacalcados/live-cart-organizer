export type CentralType = 'troca' | 'devolucao';
export function tokenAllowed(link: { request_type: string; expires_at: string; revoked_at?: string | null }, type: CentralType, now: number) {
  return link.request_type === type && !link.revoked_at && Date.parse(link.expires_at) > now;
}
export function centralDecision(input: { deliveredAt: string | null; source: string | null; unused: boolean; itemEligible: boolean }, now: number) {
  const delivered = input.deliveredAt ? Date.parse(input.deliveredAt) : NaN;
  if (input.source !== 'carrier' || !Number.isFinite(delivered) || delivered > now) return { status: 'escalado', reason: 'Ainda precisamos confirmar a data de entrega com a transportadora.' };
  if (now > delivered + 7 * 86400000) return { status: 'escalado', reason: 'O prazo precisa ser analisado por um atendente.' };
  if (!input.unused || !input.itemEligible) return { status: 'escalado', reason: 'Um atendente precisa conferir as condições do produto.' };
  return { status: 'aprovado', reason: null };
}
export function overlappingItem(existing: { item_id?: string | null; sku?: string | null; barcode?: string | null }[], item: { item_id?: string; sku?: string | null; barcode?: string | null }) {
  return existing.some(x => Boolean(item.item_id && x.item_id === item.item_id || item.sku && x.sku === item.sku || item.barcode && x.barcode === item.barcode));
}/** Espelho da regra do banco (central_submit_atomic) para o interruptor "exigir escolha do produto". */
export const NO_CHOICE_REASON = 'Produto novo a separar';
export function productChoiceRule(input: { type: CentralType; required: boolean; replacementId: string | null; desired?: string | null }) {
  if (input.type !== 'troca') return { replacementId: null, desired: null, reserve: 0 as number, forceEscalate: null as string | null };
  if (!input.required) {
    const desired = (input.desired || '').trim().slice(0, 200) || null;
    return { replacementId: null, desired, reserve: 0, forceEscalate: null };
  }
  return { replacementId: input.replacementId, desired: null, reserve: input.replacementId ? 1 : 0, forceEscalate: input.replacementId ? null : 'Um atendente ajudará a escolher o produto da troca.' };
}
