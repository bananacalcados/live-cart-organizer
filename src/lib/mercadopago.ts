// ── Integração MercadoPago.JS V2 (tokenização no navegador) ──────────────
// Gera o token do cartão + device_id no frontend, do jeito recomendado pelo MP
// (melhora a taxa de aprovação e pontua na qualidade da integração).
// Tudo aqui é tolerante a falha: se o SDK não carregar ou a tokenização falhar,
// retornamos null e o checkout segue com o cartão cru pelo Pagar.me (degradação graciosa).

import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    MercadoPago?: any;
    MP_DEVICE_SESSION_ID?: string;
  }
}

const SDK_URL = "https://sdk.mercadopago.com/js/v2";
const SECURITY_URL = "https://www.mercadopago.com/v2/security.js";

let sdkPromise: Promise<boolean> | null = null;
let mpInstance: any = null;
let cachedPublicKey: string | null = null;

function loadScript(src: string, attrs?: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(false);
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve(true);
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    if (attrs) for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** Carrega o SDK + script de segurança (device_id) e inicializa o MP. Idempotente. */
export function initMercadoPago(): Promise<boolean> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    try {
      // Busca a chave pública da conta MP ativa
      const { data } = await supabase.functions.invoke("mercadopago-get-public-key");
      cachedPublicKey = data?.publicKey || null;
      if (!cachedPublicKey) {
        console.warn("[MP] Sem public key — SDK não inicializado.");
        return false;
      }

      // Script de segurança: popula window.MP_DEVICE_SESSION_ID
      await loadScript(SECURITY_URL, { view: "checkout", output: "deviceId" });

      const ok = await loadScript(SDK_URL);
      if (!ok || !window.MercadoPago) {
        console.warn("[MP] SDK falhou ao carregar.");
        return false;
      }

      mpInstance = new window.MercadoPago(cachedPublicKey, { locale: "pt-BR" });
      return true;
    } catch (e) {
      console.warn("[MP] init falhou:", e);
      return false;
    }
  })();
  return sdkPromise;
}

export interface MpCardInput {
  number: string;       // só dígitos
  holderName: string;
  expMonth: string;     // MM
  expYear: string;      // YYYY
  cvv: string;
  cpf: string;          // só dígitos
}

export interface MpTokenResult {
  mpCardToken: string;
  mpPaymentMethodId: string;
  mpIssuerId?: string;
  mpDeviceId?: string;
  /** Tipo real do meio escolhido: credit_card | debit_card */
  mpPaymentTypeId?: string;
}

export type CardMode = "credit" | "debit";

export interface CardCapabilities {
  bin: string;
  hasCredit: boolean;
  hasDebit: boolean;
  /** payment_method_id por função (ex.: visa / debvisa) */
  creditMethodId?: string;
  debitMethodId?: string;
}

const capabilitiesCache = new Map<string, CardCapabilities>();

/**
 * Consulta TODOS os meios de pagamento do BIN e classifica em crédito/débito.
 * Retorna null quando o SDK não está disponível ou o BIN é desconhecido.
 */
export async function getCardCapabilities(binRaw: string): Promise<CardCapabilities | null> {
  const bin = String(binRaw || "").replace(/\D/g, "").slice(0, 8);
  if (bin.length < 6) return null;
  const cached = capabilitiesCache.get(bin);
  if (cached) return cached;

  try {
    const ready = await initMercadoPago();
    if (!ready || !mpInstance) return null;

    const pm = await mpInstance.getPaymentMethods({ bin });
    const results: any[] = pm?.results || [];
    if (!results.length) return null;

    const credit = results.find((r) => r?.payment_type_id === "credit_card");
    const debit = results.find((r) => r?.payment_type_id === "debit_card");

    const caps: CardCapabilities = {
      bin,
      hasCredit: !!credit,
      hasDebit: !!debit,
      creditMethodId: credit?.id,
      debitMethodId: debit?.id,
    };
    capabilitiesCache.set(bin, caps);
    return caps;
  } catch (e) {
    console.warn("[MP] getCardCapabilities falhou:", e);
    return null;
  }
}

/**
 * Tokeniza o cartão no navegador. Retorna null em qualquer falha
 * (no crédito o checkout cai no fluxo Pagar.me com o cartão cru;
 *  no débito a falha deve ser tratada como erro pelo chamador).
 */
export async function tokenizeCardMP(card: MpCardInput, mode: CardMode = "credit"): Promise<MpTokenResult | null> {
  try {
    const ready = await initMercadoPago();
    if (!ready || !mpInstance) return null;

    const bin = card.number.replace(/\D/g, "").slice(0, 8);

    // Descobre payment_method_id respeitando a função escolhida (crédito x débito)
    let paymentMethodId: string | undefined;
    let paymentTypeId: string | undefined;
    let issuerId: string | undefined;
    try {
      const pm = await mpInstance.getPaymentMethods({ bin });
      const results: any[] = pm?.results || [];
      const wantedType = mode === "debit" ? "debit_card" : "credit_card";
      const match = results.find((r) => r?.payment_type_id === wantedType)
        // fallback: se não achou o tipo pedido, usa o primeiro (mantém comportamento antigo no crédito)
        || (mode === "credit" ? results[0] : undefined);
      paymentMethodId = match?.id;
      paymentTypeId = match?.payment_type_id;
      const issuerFromPm = match?.issuer?.id;
      if (issuerFromPm) issuerId = String(issuerFromPm);
    } catch (e) {
      console.warn("[MP] getPaymentMethods falhou:", e);
    }
    if (!paymentMethodId) return null;

    if (!issuerId) {
      try {
        const issuers = await mpInstance.getIssuers({ paymentMethodId, bin });
        if (issuers?.[0]?.id) issuerId = String(issuers[0].id);
      } catch { /* issuer é opcional */ }
    }

    const tokenResp = await mpInstance.createCardToken({
      cardNumber: card.number.replace(/\D/g, ""),
      cardholderName: card.holderName,
      cardExpirationMonth: card.expMonth,
      cardExpirationYear: card.expYear,
      securityCode: card.cvv,
      identificationType: "CPF",
      identificationNumber: card.cpf.replace(/\D/g, ""),
    });

    if (!tokenResp?.id) return null;

    return {
      mpCardToken: tokenResp.id,
      mpPaymentMethodId: paymentMethodId,
      mpPaymentTypeId: paymentTypeId,
      mpIssuerId: issuerId,
      mpDeviceId: window.MP_DEVICE_SESSION_ID,
    };
  } catch (e) {
    console.warn("[MP] tokenizeCardMP falhou:", e);
    return null;
  }
}

