// Cobrança de TESTE isolada na AustPay (cartão, R$ 50,00 fixo no servidor).
// Não liga a AustPay na cascata, não lê nem grava pedidos/vendas.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  austpayPciFetch, austpayTransactionsPath, detectCardBrand, isAustpayApproved, resolveAustpayConfig,
} from "../_shared/austpay.ts";

const TEST_TOKEN = "e260268792081bff";
const AMOUNT_CENTS = 5000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    if (body?.token !== TEST_TOKEN) return json({ error: "Link inválido." }, 403);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cfg = await resolveAustpayConfig(supabase);
    if (!cfg) return json({ error: "AustPay sem credenciais." }, 503);

    const c = body?.card || {};
    const digits = String(c.number || "").replace(/\D/g, "");
    const month = String(c.expMonth || "").padStart(2, "0");
    const yRaw = String(c.expYear || "").replace(/\D/g, "");
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const cvv = String(c.cvv || "").replace(/\D/g, "");
    const cpf = String(body?.cpf || "").replace(/\D/g, "");
    const name = String(body?.name || "").trim();
    const installments = Math.min(6, Math.max(1, Number(body?.installments || 1)));
    if (digits.length < 13 || !/^(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}$/.test(year) || cvv.length < 3) {
      return json({ error: "Confira os dados do cartão." }, 400);
    }
    if (!name || cpf.length !== 11) return json({ error: "Informe nome e CPF." }, 400);

    const ref = `teste-austpay-${crypto.randomUUID()}`;
    const providers = [cfg.provider || "CAPPTA", "CAPPTA", "CELCOIN", "RINNE"].filter((p, i, a) => a.indexOf(p) === i);
    let res: Response | null = null, text = "";
    for (const provider of providers) {
      res = await austpayPciFetch(cfg, austpayTransactionsPath(cfg), {
        method: "POST",
        body: {
          provider, request_id: ref, amount: AMOUNT_CENTS, currency: "BRL", capture_method: "ECOMMERCE",
          payment_method: "CREDIT_CARD", installments, external_reference: ref, refuse_on_challenge: true,
          card_data: {
            number: digits, cvv, brand: detectCardBrand(digits), expiry_month: month, expiry_year: year,
            last_digits: digits.slice(-4), cardholder_name: name,
          },
          consumer: { full_name: name, document_type: "CPF", document_number: cpf },
        },
      });
      text = await res.text();
      if (res.ok || !(res.status === 404 && /affiliation/i.test(text))) break;
    }
    console.log(`[austpay-test] ref=${ref} env=${cfg.env} http=${res?.status} body=${text.substring(0, 400)}`);
    if (!res?.ok) return json({ approved: false, error: `AustPay respondeu ${res?.status}: ${text.substring(0, 300)}` });
    const tx = JSON.parse(text || "{}");
    const status = String(tx?.status || "");
    return json({
      approved: isAustpayApproved(status), status, env: cfg.env,
      reason: tx?.status_reason || null, acquirerCode: tx?.acquirer_response_code || null,
      transactionId: tx?.id || null, reference: ref,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
