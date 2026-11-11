import { describe, it, expect } from 'vitest';
import { matchSyncGroups, defaultSiblingChecked, summarizeByCampaign, buildSyncKey, type SyncBlockRow } from '@/lib/marketing/groupDraftSync';

let n = 0;
const row = (p: Partial<SyncBlockRow>): SyncBlockRow => ({ id: `r${++n}`, campaign_id: 'A', draft_batch: 'L1', message_group_id: null, block_order: 0, message_type: 'text', message_content: 'Oi', ...p });

describe('groupDraftSync', () => {
  it('casa texto igual (espaço/maiúscula) em campanhas diferentes do mesmo lote', () => {
    expect(matchSyncGroups([row({ campaign_id: 'A' }), row({ campaign_id: 'B', message_content: '  oi ' })])).toHaveLength(1);
  });
  it('não casa entre lotes diferentes', () => {
    expect(matchSyncGroups([row({ campaign_id: 'A' }), row({ campaign_id: 'B', draft_batch: 'L2' })])).toHaveLength(0);
  });
  it('não casa mensagem sem texto', () => {
    expect(matchSyncGroups([row({ campaign_id: 'A', message_content: '' }), row({ campaign_id: 'B', message_content: ' ' })])).toHaveLength(0);
  });
  it('não casa tipo diferente', () => {
    expect(matchSyncGroups([row({ campaign_id: 'A' }), row({ campaign_id: 'B', message_type: 'image' })])).toHaveLength(0);
  });
  it('não casa quando repete na mesma campanha (ambíguo)', () => {
    expect(matchSyncGroups([row({ campaign_id: 'A' }), row({ campaign_id: 'A' }), row({ campaign_id: 'B' })])).toHaveLength(0);
  });
  it('não casa mensagens agrupadas com número diferente de blocos', () => {
    const rows = [
      row({ campaign_id: 'A', message_group_id: 'g1', block_order: 0 }),
      row({ campaign_id: 'A', message_group_id: 'g1', block_order: 1, message_type: 'image', message_content: '' }),
      row({ campaign_id: 'B', message_group_id: 'g2', block_order: 0 }),
    ];
    expect(matchSyncGroups(rows)).toHaveLength(0);
  });
  it('casa mensagens agrupadas iguais, incluindo imagem sem legenda pela posição', () => {
    const rows = [
      row({ campaign_id: 'A', message_group_id: 'g1', block_order: 0 }),
      row({ campaign_id: 'A', message_group_id: 'g1', block_order: 1, message_type: 'image', message_content: '' }),
      row({ campaign_id: 'B', message_group_id: 'g2', block_order: 0 }),
      row({ campaign_id: 'B', message_group_id: 'g2', block_order: 1, message_type: 'image', message_content: '' }),
    ];
    expect(matchSyncGroups(rows)).toEqual([['g1', 'g2']]);
  });
  it('chave por bloco', () => { expect(buildSyncKey('u', 2)).toBe('u:2'); expect(buildSyncKey('u', null)).toBe('u:0'); });
  it('cópia com conteúdo diferente vem desmarcada; bloqueada também', () => {
    const base = { anchor_id: 'a', id: 'b', campaign_id: 'B', campaign_name: 'B', scheduled_at: null };
    expect(defaultSiblingChecked({ ...base, reason: null, content_differs: false })).toBe(true);
    expect(defaultSiblingChecked({ ...base, reason: null, content_differs: true })).toBe(false);
    expect(defaultSiblingChecked({ ...base, reason: 'missing_media', content_differs: false })).toBe(false);
  });
  it('resume resultado por campanha', () => {
    const s = summarizeByCampaign([
      { anchor_id: 'a', id: 'a', campaign_id: 'A', ok: true, reason: 'ok' },
      { anchor_id: 'a', id: 'b', campaign_id: 'B', ok: false, reason: 'missing_media' },
      { anchor_id: 'a', id: 'c', campaign_id: 'B', ok: true, reason: 'past_schedule' },
    ]);
    expect(s.get('A')).toEqual({ ok: 1, past: 0, blocked: [] });
    expect(s.get('B')).toEqual({ ok: 1, past: 1, blocked: ['missing_media'] });
  });
});
