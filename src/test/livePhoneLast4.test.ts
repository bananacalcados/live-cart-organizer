import { describe, expect, it } from 'vitest';
import { savedLivePhoneLast4 } from '@/lib/livePhoneLast4';

describe('final persistente do WhatsApp', () => {
  it('recupera 3209 sem cadastro completo em um novo carrinho', () => {
    expect(savedLivePhoneLast4({ phone_last4: '3209', phone_last4_updated_at: '2026-11-25' })).toBe('3209');
  });
  it('preserva a limpeza manual sem reconstruir pelo telefone completo', () => {
    expect(savedLivePhoneLast4({ phone_last4: null, phone_last4_updated_at: '2026-11-25', whatsapp: '5533991233209' })).toBe('');
  });
  it('mostra o final histórico do pedido sem substituí-lo pelo cadastro atual', () => {
    expect(savedLivePhoneLast4({ phone_last4: '7788', phone_last4_updated_at: '2026-11-26' }, '3209')).toBe('3209');
  });
});