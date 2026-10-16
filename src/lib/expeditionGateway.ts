/** Stored settlement gateway only: never infer a gateway from the payment method or cascade. */
export const EXPEDITION_GATEWAYS = [
  { value: "mercadopago", label: "Mercado Pago" },
  { value: "appmax", label: "AppMax" },
  { value: "austpay", label: "AustPay / Rinne" },
  { value: "pagarme", label: "Pagar.me" },
  { value: "vindi", label: "Vindi" },
  { value: "point", label: "Mercado Pago Point" },
  { value: "paypal", label: "PayPal" },
  { value: "yampi", label: "Yampi (registro legado)" },
  { value: "shopify", label: "Shopify (gateway não detalhado)" },
  { value: "store-checkout", label: "Checkout da Loja (registro legado)" },
  { value: "pix", label: "Pix (gateway não informado)" },
  { value: "manual", label: "Pagamento manual" },
  { value: "pickup", label: "Pagamento na retirada" },
  { value: "unknown", label: "Gateway não informado" },
] as const;

export function expeditionGatewayLabel(gateway: string | null | undefined): string {
  if (!gateway) return "Gateway não informado";
  return EXPEDITION_GATEWAYS.find((entry) => entry.value === gateway)?.label || gateway;
}

/** Apply before pagination; unknown means missing data, not a guessed gateway. */
export function filterExpeditionGateway<T extends { eq: (column: string, value: string) => T; is: (column: string, value: null) => T }>(query: T, gateway: string): T {
  if (gateway === "all") return query;
  return gateway === "unknown" ? query.is("payment_gateway", null) : query.eq("payment_gateway", gateway);
}