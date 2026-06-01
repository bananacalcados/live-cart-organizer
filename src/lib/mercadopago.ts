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
}

/**
 * Tokeniza o cartão no navegador. Retorna null em qualquer falha
 * (o checkout então cai no fluxo Pagar.me com o cartão cru).
 */
export async function tokenizeCardMP(card: MpCardInput): Promise<MpTokenResult | null> {
  try {
    const ready = await initMercadoPago();
    if (!ready || !mpInstance) return null;

    const bin = card.number.replace(/\D/g, "").slice(0, 8);

    // Descobre payment_method_id (visa, master, elo, ...) e issuer pelo BIN
    let paymentMethodId: string | undefined;
    let issuerId: string | undefined;
    try {
      const pm = await mpInstance.getPaymentMethods({ bin });
      paymentMethodId = pm?.results?.[0]?.id;
      const issuerFromPm = pm?.results?.[0]?.issuer?.id;
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
      mpIssuerId: issuerId,
      mpDeviceId: window.MP_DEVICE_SESSION_ID,
    };
  } catch (e) {
    console.warn("[MP] tokenizeCardMP falhou (segue no Pagar.me):", e);
    return null;
  }
}
