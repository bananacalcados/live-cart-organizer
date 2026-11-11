import { describe, it, expect } from 'vitest';
import { buildApproval, copyState, defaultChecked, defaultEditCampaigns, sanitizePatch, validatePatch, isPast, type DraftCard, type DraftBlock } from '@/lib/marketing/groupDraftCards';

const copy = (id: string, o: Partial<DraftCard['copies'][0]> = {}) => ({ id, campaign_id: 'c' + id, campaign_name: id, scheduled_at: '2099-01-01T10:00:00Z', reason: null, content_differs: false, ...o });
const card = (copies: DraftCard['copies']): DraftCard => ({ card_key: 'k', draft_batch: 'b', created_by: 'claude', copies, blocks: [] });
const block = (t: string): DraftBlock => ({ id: 'b', block_order: 0, message_type: t, message_content: 'x', media_url: 'u', poll_options: null, poll_max_options: null, mention_all: false, contact_name: null, contact_phone: null, disable_link_preview: false, sync_key: null });

describe('aba Aprovação', () => {
  it('cópia com conteúdo diferente vem desmarcada; bloqueada nunca marcada', () => {
    expect(defaultChecked(copy('a'))).toBe(true);
    expect(defaultChecked(copy('b', { content_differs: true }))).toBe(false);
    expect(defaultChecked(copy('c', { reason: 'missing_media' }))).toBe(false);
    expect(copyState(copy('c', { reason: 'missing_media', content_differs: true }))).toBe('blocked');
  });
  it('aprovação ignora bloqueadas e desmarcadas', () => {
    const c = card([copy('a', { reason: 'missing_instance' }), copy('b'), copy('c'), copy('d')]);
    expect(buildApproval(c, { a: true, b: true, c: false, d: true })).toEqual({ anchor: 'b', siblings: ['d'] });
    expect(buildApproval(c, { a: true })).toBeNull();
  });
  it('edição padrão não atinge cópias com conteúdo diferente', () => {
    expect(defaultEditCampaigns(card([copy('a'), copy('b', { content_differs: true })]))).toEqual(['ca']);
  });
  it('horário e status nunca entram na edição', () => {
    expect(sanitizePatch({ message_content: 'oi', scheduled_at: 'x', status: 'pending', campaign_id: 'y' })).toEqual({ message_content: 'oi' });
  });
  it('enquete com menos de 2 opções e texto vazio são recusados', () => {
    expect(validatePatch(block('poll'), { poll_options: ['a', ' '] })).toBe('poll_needs_2_options');
    expect(validatePatch(block('text'), { message_content: '  ' })).toBe('empty_text');
    expect(validatePatch(block('image'), { message_content: '' })).toBeNull();
    expect(validatePatch(block('image'), { media_url: '' })).toBe('empty_media');
  });
  it('horário passado', () => {
    expect(isPast(copy('a', { scheduled_at: '2000-01-01T00:00:00Z' }))).toBe(true);
    expect(isPast(copy('a'))).toBe(false);
  });
});
