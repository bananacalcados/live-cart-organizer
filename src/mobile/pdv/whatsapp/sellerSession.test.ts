import { afterEach, describe, expect, it } from 'vitest';
import { readWhatsappSeller, saveWhatsappSeller } from './sellerSession';
afterEach(() => sessionStorage.clear());
describe('mesma duração e identidade do vendedor desktop', () => {
  it('escolha fica na sessão da loja e não no armazenamento permanente mobile', () => {
    saveWhatsappSeller('perola', { id: 'seller-1', name: 'Vendedora', linked_user_id: 'user-1' });
    expect(readWhatsappSeller('perola')).toBe('seller-1'); expect(readWhatsappSeller('centro')).toBeNull();
    expect(sessionStorage.getItem('pos_whatsapp_seller_linked_perola')).toBe('user-1');
    sessionStorage.clear(); expect(readWhatsappSeller('perola')).toBeNull();
  });
  it('trocar para vendedor sem usuário vinculado remove a identidade anterior', () => {
    saveWhatsappSeller('perola', { id: 'a', name: 'A', linked_user_id: 'old-user' });
    saveWhatsappSeller('perola', { id: 'b', name: 'B', linked_user_id: null });
    expect(sessionStorage.getItem('pos_whatsapp_seller_linked_perola')).toBeNull(); expect(readWhatsappSeller('perola')).toBe('b');
  });
});