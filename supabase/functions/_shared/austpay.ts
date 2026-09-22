// ── Cliente HTTP compartilhado da AustPay (plataforma Rinne) ──────────────
// Fase 0/1 do plano: tudo aqui nasce DESLIGADO. Nenhuma função existente de
// Mercado Pago / AppMax / Pagar.me é alterada — a AustPay só é acionada
// quando a chave `austpay_enabled` está ligada E as credenciais existem.

export const AUSTPAY_SANDBOX_BASE = "https://api-sandbox.rinne.com.br/core";
export const AUSTPAY_PROD_BASE = "https://api.rinne.com.br/core";
// Host PCI: aceita número/CVV em texto puro e criptografa em trânsito antes de
// chegar à API (dispensa o rinne-js no navegador). Serve SOMENTE criação de
// transação e de sessão 3DS.
export const AUSTPAY_PCI_SANDBOX_BASE = "https://pci.api-sandbox.rinne.com.br/core";
export const AUSTPAY_PCI_PROD_BASE = "https://pci.api.rinne.com.br/core";

export interface AustpayConfig {
  apiKey: string;
  merchantId: string | null;
  provider: string | null;
  baseUrl: string;
  env: "sandbox" | "production";
}

/** Lê as credenciais do ambiente. Retorna null quando não configuradas. */
export function getAustpayConfig(): AustpayConfig | null {
  const apiKey = Deno.env.get("AUSTPAY_API_KEY");
  if (!apiKey) return null;
  const env = (Deno.env.get("AUSTPAY_ENV") || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
  // A API exige `provider` (CELCOIN | RINNE | CAPPTA). Valor salvo inválido
  // ou ausente cai no padrão RINNE (provedor nativo da plataforma).
  const providerRaw = (Deno.env.get("AUSTPAY_PROVIDER") || "").trim().toUpperCase();
  const provider = ["CELCOIN", "RINNE", "CAPPTA"].includes(providerRaw) ? providerRaw : "RINNE";
  return {
    apiKey,
    merchantId: Deno.env.get("AUSTPAY_MERCHANT_ID") || null,
    provider,
    baseUrl: env === "production" ? AUSTPAY_PROD_BASE : AUSTPAY_SANDBOX_BASE,
    env,
  };
}

/**
 * Chave mestra de liga/desliga (app_settings.austpay_enabled).
 * Qualquer erro de leitura = desligado (falha segura).
 */
export async function isAustpayEnabled(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "austpay_enabled")
      .maybeSingle();
    const raw = String(data?.value ?? "").replace(/"/g, "").trim().toLowerCase();
    return raw === "true" || raw === "1";
  } catch (e) {
    console.warn("[austpay] falha ao ler austpay_enabled — mantendo desligado:", e);
    return false;
  }
}

/** Chamada autenticada à API da AustPay. Nunca lança por status HTTP. */
export async function austpayFetch(
  cfg: AustpayConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const url = `${cfg.baseUrl}${path}`;
  return await fetch(url, {
    method: init.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Caminho de criação de transação: self ou on-behalf-of merchant. */
export function austpayTransactionsPath(cfg: AustpayConfig): string {
  return cfg.merchantId
    ? `/v1/merchants/${cfg.merchantId}/transactions`
    : "/v1/transactions";
}

/** Reais → centavos (a API da Rinne trabalha sempre em centavos). */
export function toCents(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

/** Centavos → reais. */
export function fromCents(cents: number): number {
  return Math.round(Number(cents || 0)) / 100;
}

export type AustpayStatus =
  | "PROCESSING"
  | "AUTHORIZED"
  | "APPROVED"
  | "REFUSED"
  | "CANCELLED"
  | "PENDING_REFUND"
  | "PENDING_CANCELLATION"
  | "PARTIALLY_REFUNDED"
  | "AWAITING_3DS"
  | string;

export function isAustpayApproved(status: AustpayStatus): boolean {
  return status === "APPROVED" || status === "AUTHORIZED";
}

/** Gera um request_id determinístico por tentativa (idempotência da Rinne). */
export function austpayRequestId(prefix: string, orderId: string): string {
  return `${prefix}-${orderId}-${Date.now()}`;
}

/** Base do host PCI (criação de transação com cartão em texto puro). */
export function austpayPciBase(cfg: AustpayConfig): string {
  return cfg.env === "production" ? AUSTPAY_PCI_PROD_BASE : AUSTPAY_PCI_SANDBOX_BASE;
}

/** Chamada ao host PCI (mesma autenticação, base diferente). */
export function austpayPciFetch(
  cfg: AustpayConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return austpayFetch({ ...cfg, baseUrl: austpayPciBase(cfg) }, path, init);
}

/** Bandeira do cartão a partir do número (a API exige `brand`). */
export function detectCardBrand(numberDigits: string): string {
  const n = String(numberDigits || "").replace(/\D/g, "");
  if (/^4/.test(n)) return "VISA";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return "MASTERCARD";
  if (/^3[47]/.test(n)) return "AMEX";
  if (/^(606282|3841)/.test(n)) return "HIPERCARD";
  if (/^(38|60)/.test(n)) return "HIPERCARD";
  if (/^(30[0-5]|36|38)/.test(n)) return "DINERS";
  if (/^(4011|4312|4389|4514|4576|5041|5067|509|6277|6363|650|6516|6550)/.test(n)) return "ELO";
  return "VISA";
}

/** Consulta uma transação pelo id. */
export function austpayGetTransaction(cfg: AustpayConfig, transactionId: string): Promise<Response> {
  return austpayFetch(cfg, `/v1/transactions/${transactionId}`);
}
