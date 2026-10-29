/** Must match event_phone_key / selfservicePhoneKey on the server. */
export function selfServiceDraftPhoneKey(phone?: string | null): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function mergeSelfServiceDraft<T extends Record<string, string>>(
  current: T, draft: Record<string, unknown>, keys: readonly (keyof T)[], touched: ReadonlySet<string>,
): T {
  let next = current;
  for (const key of keys) {
    if (!(key in draft) || touched.has(String(key))) continue;
    const value = String(draft[String(key)] ?? "");
    if (current[key] === value) continue;
    if (next === current) next = { ...current };
    next[key] = value as T[keyof T];
  }
  return next;
}

export function liveStaffCartLink(event: { operation_mode?: string | null; self_service_slug?: string | null } | undefined, orderId: string): string | null {
  if (event?.operation_mode !== "whatsapp_autoatendimento" || !event.self_service_slug) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return null;
  // ?pgto=cartao: o link da equipe abre direto na tela do cartão de crédito.
  return `https://checkout.bananacalcados.com.br/pedido/${event.self_service_slug}/carrinho/${orderId.replace(/-/g, "")}?pgto=cartao`;
}