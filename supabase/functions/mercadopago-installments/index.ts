import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getActiveMpAccount } from "../_shared/mp-account.ts";
import { buildMpHeaders } from "../_shared/mp-http.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Consulta as condições REAIS de parcelamento da conta Mercado Pago ativa.
 * Retorna, para cada nº de parcelas, se há juros para o comprador e o valor exato
 * que o cartão será cobrado (total_amount / installment_amount).
 *
 * Isso evita anunciar "sem juros" no checkout quando o Mercado Pago, na prática,
 * está financiando o parcelamento e cobrando juros do cliente.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { amount, bin, paymentMethodId } = await req.json();
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("amount inválido");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const account = await getActiveMpAccount(supabase);
    if (!account?.access_token) throw new Error("Nenhuma conta Mercado Pago ativa");

    const qs = new URLSearchParams({ amount: value.toFixed(2) });
    const cleanBin = String(bin || "").replace(/\D/g, "").slice(0, 8);
    if (cleanBin.length >= 6) qs.set("bin", cleanBin);
    else if (paymentMethodId) qs.set("payment_method_id", String(paymentMethodId));

    const res = await fetch(
      `https://api.mercadopago.com/v1/payment_methods/installments?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${account.access_token}` } },
    );
    const raw = await res.text();
    if (!res.ok) {
      console.error(`[mp-installments] ${res.status}: ${raw}`);
      return new Response(JSON.stringify({ error: "mp_error", status: res.status, details: raw }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = JSON.parse(raw || "[]");
    const first = Array.isArray(data) ? data[0] : null;
    const options = (first?.payer_costs || []).map((pc: any) => ({
      installments: pc.installments,
      installmentRate: Number(pc.installment_rate || 0),
      installmentAmount: Number(pc.installment_amount || 0),
      totalAmount: Number(pc.total_amount || 0),
      interestFree: Number(pc.installment_rate || 0) === 0
        && Math.abs(Number(pc.total_amount || 0) - value) < 0.01,
      labels: pc.labels || [],
    }));

    return new Response(
      JSON.stringify({
        amount: value,
        paymentMethodId: first?.payment_method_id || null,
        issuerId: first?.issuer?.id || null,
        options,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mp-installments] error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
