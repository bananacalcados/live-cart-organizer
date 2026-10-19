import { describe, expect, it } from 'vitest';
import { appendDraftMedia, removeDraftMedia } from '@/lib/marketing/draftMediaCaption';

const caption = '*SANDÁLIA LÍVIA*\nDe ~R$199,99~ por *R$119,99*\n{{link_atendimento}}';
const draft = () => ({ content: caption, mediaItems: [] as { url: string; caption: string }[] });

describe('legenda de mídia de rascunho VIP', () => {
  it('passa o texto completo ao primeiro arquivo e limpa o texto pendente', () => {
    const next = appendDraftMedia(draft(), [{ url: 'foto.jpg', caption: '' }]);
    expect(next.mediaItems).toEqual([{ url: 'foto.jpg', caption }]);
    expect(next.content).toBe('');
  });
  it('com vários arquivos passa a legenda somente ao primeiro', () => {
    expect(appendDraftMedia(draft(), [
      { url: 'um.jpg', caption: '' }, { url: 'dois.jpg', caption: '' },
    ]).mediaItems.map(i => i.caption)).toEqual([caption, '']);
  });
  it('não altera legendas de arquivos existentes nem preenche os adicionais', () => {
    const block = { content: '', mediaItems: [{ url: 'um.jpg', caption }] };
    expect(appendDraftMedia(block, [{ url: 'dois.jpg', caption: '' }]).mediaItems)
      .toEqual([{ url: 'um.jpg', caption }, { url: 'dois.jpg', caption: '' }]);
  });
  it('nenhum upload bem-sucedido mantém a legenda pendente', () => {
    const block = draft();
    expect(appendDraftMedia(block, [])).toBe(block);
    expect(block.content).toBe(caption);
  });
  it('remover o último arquivo devolve sua legenda ao bloco', () => {
    expect(removeDraftMedia(appendDraftMedia(draft(), [{ url: 'um.jpg', caption: '' }]), 0))
      .toEqual({ content: caption, mediaItems: [] });
  });
  it('remover um arquivo com outros restantes preserva o comportamento atual', () => {
    const block = { content: '', mediaItems: [{ url: 'um.jpg', caption }, { url: 'dois.jpg', caption: 'outra' }] };
    expect(removeDraftMedia(block, 0)).toEqual({ content: '', mediaItems: [{ url: 'dois.jpg', caption: 'outra' }] });
  });
});