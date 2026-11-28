/** Uses the same per-store, per-tab session keys as desktop WhatsApp. */
export function readWhatsappSeller(storeId: string): string | null {
  try { return sessionStorage.getItem(`pos_whatsapp_seller_id_${storeId}`); } catch { return null; }
}
export function saveWhatsappSeller(storeId: string, seller: { id: string; name: string; linked_user_id: string | null }) {
  try {
    sessionStorage.setItem(`pos_whatsapp_seller_id_${storeId}`, seller.id);
    sessionStorage.setItem(`pos_whatsapp_seller_name_${storeId}`, seller.name);
    const key = `pos_whatsapp_seller_linked_${storeId}`;
    if (seller.linked_user_id) sessionStorage.setItem(key, seller.linked_user_id); else sessionStorage.removeItem(key);
  } catch { /* Selection remains in memory when browser storage is unavailable. */ }
}