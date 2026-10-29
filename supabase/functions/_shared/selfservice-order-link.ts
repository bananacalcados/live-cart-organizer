/** A payment message must always point at the exact source order, never a cached cart. */
export function selfserviceOrderLink(event: { operation_mode?: string | null; self_service_slug?: string | null }, orderId?: string | null): string | null {
  if (!orderId || event.operation_mode !== "whatsapp_autoatendimento" || !event.self_service_slug) return null;
  return `https://checkout.bananacalcados.com.br/pedido/${event.self_service_slug}/carrinho/${orderId.replace(/-/g, "")}`;
}