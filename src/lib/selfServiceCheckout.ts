export interface SelfServiceCheckoutOrder {
  id: string;
  registered_at?: string | null;
  registration_confirmed?: boolean;
  free_shipping?: boolean;
  shipping_cost?: number | null;
}

export function canPayRegisteredOrder(order: SelfServiceCheckoutOrder): boolean {
  return !!order.registered_at && order.registration_confirmed === true;
}

/** The combined preview must retain the previous confirmed/expired guards. */
export function canFillSelfServiceRegistration(hasOrders: boolean, registrationConfirmed: boolean, reserveExpired: boolean): boolean {
  return !hasOrders || (!registrationConfirmed && !reserveExpired);
}

export function selfServiceShipping(order: SelfServiceCheckoutOrder): number {
  return order.free_shipping ? 0 : Math.max(0, Number(order.shipping_cost) || 0);
}

/** Link enviado pela equipe com ?pgto=cartao abre o carrinho já na tela do cartão. */
export function initialCartMode(search: string): "choose" | "card" {
  return new URLSearchParams(search).get("pgto") === "cartao" ? "card" : "choose";
}