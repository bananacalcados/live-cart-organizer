// Cliente HTTP compartilhado do Mercado Pago.
// Centraliza headers de autenticação, idempotência, device_id e identificação
// da integração. Não altera regra de negócio de nenhum gateway.

export interface MpHeaderOptions {
  accessToken: string;
  /** Chave de idempotência (obrigatória em criação de pagamento) */
  idempotencyKey?: string;
  /** device_id gerado pelo security.js no navegador */
  deviceId?: string;
}

export function buildMpHeaders(opts: MpHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.accessToken}`,
  };
  if (opts.idempotencyKey) headers["X-Idempotency-Key"] = opts.idempotencyKey;
  if (opts.deviceId) headers["X-meli-session-id"] = opts.deviceId;

  // Identificação da integração (pontua na qualidade). Só enviados se configurados.
  const integratorId = Deno.env.get("MERCADOPAGO_INTEGRATOR_ID");
  if (integratorId) headers["X-Integrator-Id"] = integratorId;
  const platformId = Deno.env.get("MERCADOPAGO_PLATFORM_ID");
  if (platformId) headers["X-Platform-Id"] = platformId;

  return headers;
}
