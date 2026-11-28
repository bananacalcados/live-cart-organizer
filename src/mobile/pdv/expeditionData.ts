import { isPickup, onlyDigits, type ExpOrder } from "@/lib/pos/expedition";
import { isValidCpf } from "@/lib/cpfUtils";
import { expeditionShippingError } from "@/lib/pos/expeditionActions";

/** Read-only union of ExpOrderEditDialog/customerHydrate and trackingMessage aliases.
 * Sale values always win over link metadata and the customer record; never persists anything.
 */
export function mobileOrderAddress(order: ExpOrder, customer: Record<string, unknown> = {}) {
  const a = order.shipping_address || {}, pd = order.payment_details || {};
  const first = (...values: unknown[]) => values.map(v => String(v ?? "").trim()).find(Boolean) || "";
  return {
    address: first(a.address, a.street, a.address1, a.logradouro, pd.customer_address, customer.address),
    number: first(a.number, a.numero, pd.customer_address_number, customer.address_number),
    complement: first(a.complement, a.complemento, pd.customer_complement, customer.complement),
    neighborhood: first(a.neighborhood, a.bairro, a.district, a.address2, pd.customer_neighborhood, customer.neighborhood),
    city: first(a.city, a.cidade, pd.customer_city, customer.city),
    state: first(a.state, a.uf, a.province, pd.customer_state, customer.state),
    cep: first(a.cep, a.zip_code, a.zipcode, a.zip, pd.customer_cep, customer.cep),
  };
}

/** Desktop edit guards: CPF is validated only if present; address required for a chosen non-pickup carrier.
 * Shipping completion guards apply only in conference, not to new/preparation orders.
 * No extra phone/payment guard (these were mobile-only requirements).
 */
export function mobileMissingOrderData(order: ExpOrder): string[] {
  const pd = order.payment_details || {}, a = mobileOrderAddress(order);
  const carrier = order.shipping_carrier || order.delivery_method || "";
  const missing: string[] = [];
  if (!String(order.customer_name || pd.customer_name || "").trim()) missing.push("nome");
  const cpf = onlyDigits(order.customer_cpf || pd.customer_cpf);
  if (cpf && !isValidCpf(cpf)) missing.push("CPF inválido");
  if (carrier && !isPickup(carrier) && !order.is_store_pickup) {
    if (onlyDigits(a.cep).length !== 8) missing.push("CEP");
    if (!a.address || !a.number || !a.neighborhood || !a.city || !a.state) missing.push("endereço");
  }
  if (order.expedition_stage === "conferencia") {
    const error = expeditionShippingError({ carrier, tracking: order.tracking_code || "", courier: order.courier_name || "",
      trackingUrl: order.tracking_url || "", deliveryDays: order.delivery_days || "", cost: order.shipping_cost == null ? NaN : Number(order.shipping_cost) });
    if (error) missing.push(error === "Selecione a forma de envio" ? "frete" : error);
  }
  return missing;
}

export function mobileAddressLine(order: ExpOrder) {
  const a = mobileOrderAddress(order);
  return [[a.address, a.number].filter(Boolean).join(", "), a.complement, a.neighborhood, [a.city, a.state].filter(Boolean).join("/"), a.cep].filter(Boolean).join(" — ");
}