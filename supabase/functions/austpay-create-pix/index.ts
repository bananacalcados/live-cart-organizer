// ── AustPay (Rinne): cobrança Pix ─────────────────────────────────────────
// Fase 1 do plano. Só responde quando a chave `austpay_enabled` está ligada
// e as credenciais existem. É o DEGRAU SEGUINTE ao Mercado Pago — nunca o
// primeiro. A resposta usa o mesmo formato do PIX do MP para que os
// checkouts existentes consumam sem qualquer alteração de tela.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  austpayFetch,
  austpayRequestId,
  austpayTransactionsPath,
  getAustpayConfig,
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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

const PIX_EXPIRATION_SECONDS = 3600;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

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
    const payer = body?.payer || {};

    if (!orderId) throw new Error("orderId is required");
    if (!(amount > 0)) throw new Error("amount must be greater than zero");

    // ── Trava dupla: chave mestra + credenciais ──
    const enabled = await isAustpayEnabled(supabase);
    if (!enabled) {
      return new Response(JSON.stringify({ error: "austpay_disabled", enabled: false }), {
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

    const cpf = String(payer?.cpf || "").replace(/\D/g, "");
    const fullName = [payer?.firstName, payer?.lastName].filter(Boolean).join(" ").trim();

    const txBody: Record<string, unknown> = {
      request_id: austpayRequestId("pix", orderId),
      amount: toCents(amount),
      currency: "BRL",
      capture_method: "ECOMMERCE",
      payment_method: "PIX",
      external_reference: String(orderId),
      pix_data: {
        description: `Pedido #${orderId.substring(0, 8)}`,
        expiration_in_seconds: PIX_EXPIRATION_SECONDS,
      },
    };
    if (cfg.provider) txBody.provider = cfg.provider;
    if (fullName || cpf) {
      txBody.consumer = {
        ...(fullName ? { full_name: fullName } : {}),
        ...(cpf.length === 11 ? { document_type: "CPF", document_number: cpf } : {}),
        ...(payer?.email ? { email: String(payer.email) } : {}),
      };
    }

    // Tenta o provedor configurado; se a conta não tiver afiliação com ele
    // (404 "Affiliation ... not found"), tenta os demais provedores.
    const providers = [cfg.provider, "CELCOIN", "RINNE", "CAPPTA"]
      .filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i);
    let res: Response | null = null;
    let text = "";
    for (const p of providers) {
      const attempt = { ...txBody, provider: p };
      res = await austpayFetch(cfg, austpayTransactionsPath(cfg), {
        method: "POST",
        body: attempt,
      });
      text = await res.text();
      if (res.ok) {
        console.log(`[austpay-pix] provedor utilizado: ${p}`);
        break;
      }
      const affiliationMissing = res.status === 404 && text.includes("Affiliation");
      if (!affiliationMissing) break;
      console.warn(`[austpay-pix] sem afiliação com ${p}; tentando próximo provedor`);
    }

    if (!res || !res.ok) {
      throw new Error(`AustPay error ${res?.status}: ${text.substring(0, 500)}`);
    }

    const tx = JSON.parse(text || "{}");
    const pix = tx?.pix_data || tx?.pix || {};
    const qrCode = pix?.qr_code || pix?.emv || pix?.copy_paste || null;
    const qrCodeBase64 = pix?.qr_code_base64 || pix?.qr_code_image || null;

    // Vincula a transação ao pedido / venda para conciliação (Fase 2).
    const txId = String(tx?.id || tx?.transaction_id || "");
    if (txId) {
      const { data: orderRow } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
      if (orderRow) {
        await supabase.from("orders").update({ austpay_transaction_id: txId }).eq("id", orderId);
      } else {
        await supabase.from("pos_sales").update({ austpay_transaction_id: txId }).eq("id", orderId);
      }
    }

    console.log(`[austpay-pix] transação ${txId} criada para ${orderId} (${cfg.env})`);

    return new Response(
      JSON.stringify({
        gateway: "austpay",
        paymentId: txId,
        status: tx?.status || "PROCESSING",
        qrCode,
        qrCodeBase64,
        ticketUrl: pix?.ticket_url || null,
        expirationDate: pix?.expires_at || null,
        amount: amount.toFixed(2),
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    console.error("[austpay-pix] erro:", message);

    await logCheckoutFailure(supabase, {
      sale_id: orderId || "austpay-sem-pedido",
      payment_method: "pix",
      gateway: "austpay",
      status: "failed",
      error_message: `Falha ao gerar PIX AustPay: ${message}`,
      amount: amount || null,
      metadata: { source: "austpay-create-pix" },
    });

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
