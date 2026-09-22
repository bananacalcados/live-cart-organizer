// ── AustPay (Rinne): cobrança no cartão ───────────────────────────────────
// Fase 3 do plano — ÚLTIMO degrau da cascata, nunca o primeiro.
// A Rinne só aceita número e CVV CRIPTOGRAFADOS pelo rinne-js no navegador
// (valores com prefixo "ev:"). Esta função recusa qualquer dado de cartão em
// texto puro, então é impossível ela "roubar" o fluxo do Mercado Pago:
// sem o SDK liberado, ela simplesmente não é acionada.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  austpayFetch,
  austpayRequestId,
  austpayTransactionsPath,
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

    // ── Trava de segurança: só dados criptografados pelo rinne-js ──
    const cardId = card?.cardId ? String(card.cardId) : "";
    const encNumber = card?.number ? String(card.number) : "";
    const encCvv = card?.cvv ? String(card.cvv) : "";
    if (!cardId) {
      if (!encNumber.startsWith("ev:") || !encCvv.startsWith("ev:")) {
        throw new Error(
          "Dados do cartão precisam vir criptografados pelo rinne-js (prefixo ev:). Cobrança recusada.",
        );
      }
    }

    const cardData: Record<string, unknown> = cardId
      ? { card_id: cardId }
      : {
          number: encNumber,
          cvv: encCvv,
          holder_name: card?.holderName || undefined,
          expiration_month: card?.expMonth || undefined,
          expiration_year: card?.expYear || undefined,
        };

    const txBody: Record<string, unknown> = {
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
    if (cfg.provider) txBody.provider = cfg.provider;
    const cpf = String(holder?.cpf || "").replace(/\D/g, "");
    if (holder?.name || cpf) {
      txBody.consumer = {
        ...(holder?.name ? { full_name: String(holder.name) } : {}),
        ...(cpf.length === 11 ? { document_type: "CPF", document_number: cpf } : {}),
        ...(holder?.email ? { email: String(holder.email) } : {}),
      };
    }

    const res = await austpayFetch(cfg, austpayTransactionsPath(cfg), { method: "POST", body: txBody });
    const text = await res.text();
    if (!res.ok) throw new Error(`AustPay error ${res.status}: ${text.substring(0, 500)}`);

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
