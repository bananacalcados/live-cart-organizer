export function registrationCustomerIds(orders: Array<{ customer_id?: string | null }>): string[] {
  return [...new Set(orders.map((order) => order.customer_id).filter((id): id is string => !!id))];
}
