import { describe, expect, it } from 'vitest';
import { findMirrorUpdates, normalizeMessageText } from '@/lib/marketing/mirrorGroupMedia';

const edited = [
  { message_type: 'image', message_content: '*PAPETE SANDÁLIA LÍDIA*\nDe ~R$160,00~ por *R$49,99*', media_url: 'https://cdn.test/nova.jpg' },
];

describe('espelhamento de mídia entre campanhas', () => {
  it('casa texto idêntico ignorando espaços e maiúsculas', () => {
    const updates = findMirrorUpdates(edited, [
      { id: 'a', campaign_id: 'camp2', message_type: 'image', message_content: '  *papete sandália lídia* De ~R$160,00~ por *R$49,99* ', media_url: null },
    ]);
    expect(updates).toEqual([{ id: 'a', campaign_id: 'camp2', newMediaUrl: 'https://cdn.test/nova.jpg' }]);
  });

  it('nunca casa mensagem sem texto (conteúdo vazio)', () => {
    const semTexto = [{ message_type: 'image', message_content: null, media_url: 'https://cdn.test/nova.jpg' }];
    const updates = findMirrorUpdates(semTexto, [
      { id: 'a', campaign_id: 'camp2', message_type: 'image', message_content: null, media_url: null },
      { id: 'b', campaign_id: 'camp2', message_type: 'image', message_content: '   ', media_url: null },
    ]);
    expect(updates).toEqual([]);
  });

  it('não casa texto diferente nem tipo de mídia diferente', () => {
    const updates = findMirrorUpdates(edited, [
      { id: 'a', campaign_id: 'camp2', message_type: 'image', message_content: '*OUTRA SANDÁLIA*', media_url: null },
      { id: 'b', campaign_id: 'camp2', message_type: 'video', message_content: '*PAPETE SANDÁLIA LÍDIA*\nDe ~R$160,00~ por *R$49,99*', media_url: null },
    ]);
    expect(updates).toEqual([]);
  });

  it('pula quem já tem exatamente a mesma URL', () => {
    const updates = findMirrorUpdates(edited, [
      { id: 'a', campaign_id: 'camp2', message_type: 'image', message_content: '*PAPETE SANDÁLIA LÍDIA*\nDe ~R$160,00~ por *R$49,99*', media_url: 'https://cdn.test/nova.jpg' },
    ]);
    expect(updates).toEqual([]);
  });

  it('normalizeMessageText colapsa quebras de linha e espaços', () => {
    expect(normalizeMessageText('  Olá\n\nMundo  ')).toBe('olá mundo');
    expect(normalizeMessageText(null)).toBe('');
  });
});
