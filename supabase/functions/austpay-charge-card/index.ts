// ── AustPay (Rinne): cobrança no cartão ───────────────────────────────────
// Fase 3 do plano — ÚLTIMO degrau da cascata, nunca o primeiro.
// A Rinne não aceita PAN/CVV em texto puro no host normal, mas oferece o HOST
// PCI (pci.api...), que criptografa número e CVV em trânsito antes de chegar à
// API. Com isso NÃO é preciso o rinne-js no navegador: o formulário de cartão
// atual do checkout continua exatamente igual e a AustPay só é chamada quando
// os gateways anteriores já recusaram.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  austpayPciFetch,
  austpayRequestId,
  austpayTransactionsPath,
  detectCardBrand,
  getAustpayConfig,
  isAustpayApproved,
  isAustpayEnabled,
  toCents,
} from "../_shared/austpay.ts";
import { logCheckoutFailure } from "../_shared/checkout-failure-log.ts";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function isAllowedOrigin(origin: string) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:") return false;
    return hostname.endsWith(".lovable.app") || hostname.endsWith(".lovableproject.com");
  } catch {
    return false;
  }
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let orderId = "";
  let amount = 0;

  try {
    const body = await req.json();
    orderId = String(body?.orderId || "");
    amount = Number(body?.amount || 0);
    const installments = Math.max(1, Number(body?.installments || 1));
    const mode = String(body?.mode || "credit").toLowerCase();
    const card = body?.card || {};
    const holder = body?.holder || {};

    if (!orderId) throw new Error("orderId is required");
    if (!(amount > 0)) throw new Error("amount must be greater than zero");

    const enabled = await isAustpayEnabled(supabase);
    if (!enabled) {
      return new Response(JSON.stringify({ error: "austpay_disabled" }), {
        status: 503,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const cfg = getAustpayConfig();
    if (!cfg) {
      return new Response(JSON.stringify({ error: "austpay_not_configured" }), {
        status: 503,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // ── Dados do cartão ──
    // O host PCI aceita número/CVV em texto puro (criptografa em trânsito) e
    // também deixa passar valores já criptografados pelo rinne-js ("ev:").
    const cardId = card?.cardId ? String(card.cardId) : "";
    const rawNumber = String(card?.number || "").trim();
    const digits = rawNumber.startsWith("ev:") ? "" : rawNumber.replace(/\D/g, "");
    const cvv = String(card?.cvv || "").trim();
    const expMonth = String(card?.expMonth || "").padStart(2, "0");
    const expYearRaw = String(card?.expYear || "").replace(/\D/g, "");
    const expYear = expYearRaw.length === 2 ? `20${expYearRaw}` : expYearRaw;
    const lastDigits = String(card?.lastDigits || digits.slice(-4) || "");

    if (!cardId) {
      if (!rawNumber) throw new Error("Número do cartão ausente.");
      if (!/^(0[1-9]|1[0-2])$/.test(expMonth) || !/^\d{4}$/.test(expYear)) {
        throw new Error("Validade do cartão inválida.");
      }
      if (!/^\d{4}$/.test(lastDigits)) throw new Error("Não foi possível identificar o final do cartão.");
    }

    const cardData: Record<string, unknown> = cardId
      ? { card_id: cardId, expiry_month: expMonth, expiry_year: expYear, last_digits: lastDigits }
      : {
          number: rawNumber,
          ...(cvv ? { cvv } : {}),
          brand: String(card?.brand || detectCardBrand(digits)).toUpperCase(),
          expiry_month: expMonth,
          expiry_year: expYear,
          last_digits: lastDigits,
          ...(card?.holderName ? { cardholder_name: String(card.holderName) } : {}),
        };

    const buildBody = (provider: string) => {
      const txBody: Record<string, unknown> = {
        provider,
        request_id: austpayRequestId("card", orderId),
        amount: toCents(amount),
        currency: "BRL",
        capture_method: "ECOMMERCE",
        payment_method: mode === "debit" ? "DEBIT_CARD" : "CREDIT_CARD",
        installments,
        external_reference: String(orderId),
        card_data: cardData,
        // Não travar a venda em desafio 3DS na primeira versão.
        refuse_on_challenge: true,
      };
      const cpf = String(holder?.cpf || "").replace(/\D/g, "");
      if (holder?.name || cpf) {
        txBody.consumer = {
          ...(holder?.name ? { full_name: String(holder.name) } : {}),
          ...(cpf.length === 11 ? { document_type: "CPF", document_number: cpf } : {}),
          ...(holder?.email ? { email: String(holder.email) } : {}),
        };
      }
      return txBody;
    };

    // A afiliação ativa da conta define o provedor. Tentamos o configurado e,
    // se a afiliação não existir, os demais.
    const providers = [cfg.provider || "CAPPTA", "CAPPTA", "CELCOIN", "RINNE"]
      .filter((p, i, arr) => arr.indexOf(p) === i);

    let res: Response | null = null;
    let text = "";
    for (const provider of providers) {
      res = await austpayPciFetch(cfg, austpayTransactionsPath(cfg), {
        method: "POST",
        body: buildBody(provider),
      });
      text = await res.text();
      if (res.ok) {
        console.log(`[austpay-card] provedor usado: ${provider}`);
        break;
      }
      if (!(res.status === 404 && /affiliation/i.test(text))) break;
    }
    if (!res || !res.ok) throw new Error(`AustPay error ${res?.status}: ${text.substring(0, 500)}`);

    const tx = JSON.parse(text || "{}");
    const txId = String(tx?.id || tx?.transaction_id || "");
    const status = String(tx?.status || "");

    if (txId) {
      const { data: orderRow } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
      if (orderRow) await supabase.from("orders").update({ austpay_transaction_id: txId }).eq("id", orderId);
      else await supabase.from("pos_sales").update({ austpay_transaction_id: txId }).eq("id", orderId);
    }

    const approved = isAustpayApproved(status);
    console.log(`[austpay-card] tx=${txId} status=${status} pedido=${orderId}`);

    if (!approved) {
      await logCheckoutFailure(supabase, {
        sale_id: orderId,
        payment_method: mode === "debit" ? "debit_card" : "credit_card",
        gateway: "austpay",
        status: "failed",
        error_message: `AustPay recusou: ${status} ${tx?.status_reason || ""}`.trim(),
        amount,
        transaction_id: txId || null,
        metadata: { source: "austpay-charge-card", status },
      });
    }

    return new Response(
      JSON.stringify({
        gateway: "austpay",
        approved,
        status,
        statusReason: tx?.status_reason || null,
        transactionId: txId,
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    console.error("[austpay-card] erro:", message);

    await logCheckoutFailure(supabase, {
      sale_id: orderId || "austpay-sem-pedido",
      payment_method: "credit_card",
      gateway: "austpay",
      status: "error",
      error_message: message,
      amount: amount || null,
      metadata: { source: "austpay-charge-card" },
    });

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
