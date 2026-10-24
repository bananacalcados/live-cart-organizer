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

export function selfServiceShipping(order: SelfServiceCheckoutOrder): number {
  return order.free_shipping ? 0 : Math.max(0, Number(order.shipping_cost) || 0);
}