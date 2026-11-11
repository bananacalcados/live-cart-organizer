/**
 * Aba central "Aprovação" dos Grupos VIP: regras puras dos cards (uma mensagem lógica,
 * N cópias em campanhas diferentes ligadas por sync_key).
 */
export interface DraftCopy {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  scheduled_at: string | null;
  reason: string | null;
  content_differs: boolean;
  has_instance?: boolean;
}
export interface DraftBlock {
  id: string;
  block_order: number;
  message_type: string;
  message_content: string | null;
  media_url: string | null;
  poll_options: string[] | null;
  poll_max_options: number | null;
  mention_all: boolean | null;
  contact_name: string | null;
  contact_phone: string | null;
  disable_link_preview: boolean | null;
  sync_key: string | null;
}
export interface DraftCard {
  card_key: string;
  draft_batch: string | null;
  created_by: string | null;
  copies: DraftCopy[];
  blocks: DraftBlock[];
}

export const DRAFT_REASON_LABELS: Record<string, string> = {
  missing_media: 'sem foto/mídia',
  poll_needs_2_options: 'enquete com menos de 2 opções',
  missing_contact_phone: 'contato sem número',
  missing_schedule: 'sem horário',
  missing_instance: 'sem número de WhatsApp',
  vip_link_without_mode: '{{link_atendimento}} sem modo',
  not_draft: 'já não é rascunho',
  not_found: 'não encontrada',
  empty_text: 'texto vazio',
  empty_media: 'mídia vazia',
  not_poll: 'bloco não é enquete',
  unchanged: 'sem mudança',
};

export const EDITABLE_FIELDS = ['message_content', 'media_url', 'poll_options', 'poll_max_options', 'mention_all', 'contact_name', 'contact_phone', 'disable_link_preview'] as const;

export function isPast(c: DraftCopy, now = Date.now()): boolean {
  return !!c.scheduled_at && new Date(c.scheduled_at).getTime() < now;
}

export type CopyState = 'blocked' | 'differs' | 'ready';
export function copyState(c: DraftCopy): CopyState {
  if (c.reason) return 'blocked';
  if (c.content_differs) return 'differs';
  return 'ready';
}

/** Caixa já marcada: aprovável e com o mesmo conteúdo. Bloqueada nunca tem caixa. */
export function defaultChecked(c: DraftCopy): boolean {
  return !c.reason && !c.content_differs;
}

/** Monta a chamada de aprovação: âncora = 1ª cópia marcada aprovável; irmãs = demais marcadas aprováveis. */
export function buildApproval(card: DraftCard, checked: Record<string, boolean>): { anchor: string; siblings: string[] } | null {
  const ok = card.copies.filter(c => !c.reason && checked[c.id]);
  if (ok.length === 0) return null;
  return { anchor: ok[0].id, siblings: ok.slice(1).map(c => c.id) };
}

/** Campanhas que recebem a edição. Padrão: todas as cópias com o mesmo conteúdo (as diferentes vêm de fora). */
export function defaultEditCampaigns(card: DraftCard): string[] {
  return card.copies.filter(c => !c.content_differs).map(c => c.campaign_id);
}

/** Só deixa passar campos de conteúdo permitidos (horário, campanha, status etc. nunca vão). */
export function sanitizePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) if (k in patch) out[k] = patch[k];
  return out;
}

export function validatePatch(block: DraftBlock, patch: Record<string, unknown>): string | null {
  if ('poll_options' in patch) {
    const opts = (patch.poll_options as string[] | null) || [];
    if (opts.filter(o => o.trim()).length < 2) return 'poll_needs_2_options';
  }
  if (block.message_type === 'text' && 'message_content' in patch && !String(patch.message_content || '').trim()) return 'empty_text';
  if (['image', 'video', 'audio', 'document'].includes(block.message_type) && 'media_url' in patch && !String(patch.media_url || '').trim()) return 'empty_media';
  return null;
}
