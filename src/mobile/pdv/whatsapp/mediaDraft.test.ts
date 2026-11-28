import { describe, expect, it } from 'vitest';
import { mediaDraftError, mobileMediaKind } from './mediaDraft';
describe('mídia usa os limites existentes do desktop', () => {
  it('vídeo permanece vídeo no envio compartilhado', () => expect(mobileMediaKind({ type: 'video/mp4' })).toBe('video'));
  it('aceita 64MB e rejeita acima do limite de vídeo', () => {
    expect(mediaDraftError({ type: 'video/mp4', size: 64 * 1024 * 1024 })).toBeNull();
    expect(mediaDraftError({ type: 'video/mp4', size: 64 * 1024 * 1024 + 1 })).not.toBeNull();
  });
});