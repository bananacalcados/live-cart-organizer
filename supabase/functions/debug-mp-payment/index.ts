import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getMpAccountByPaymentId } from "../_shared/mp-account.ts";
import { mpGetPayment } from "../_shared/mp-http.ts";

// Diagnóstico temporário: retorna os campos do pagamento no Mercado Pago
// relevantes para entender por que um boleto não pôde ser pago.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { paymentId } = await req.json();
    if (!/^\d+$/.test(String(paymentId))) {
      return new Response(JSON.stringify({ error: "invalid paymentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const acc = await getMpAccountByPaymentId(sb, String(paymentId));
    if (!acc?.access_token) throw new Error("conta MP não resolvida");
    const res = await mpGetPayment(acc.access_token, paymentId);
    const p = await res.json();
    return new Response(
      JSON.stringify({
        status: p.status,
        status_detail: p.status_detail,
        payment_method_id: p.payment_method_id,
        payment_type_id: p.payment_type_id,
        date_created: p.date_created,
        date_of_expiration: p.date_of_expiration,
        date_last_updated: p.date_last_updated,
        transaction_amount: p.transaction_amount,
        barcode: p.barcode,
        transaction_details: p.transaction_details,
        live_mode: p.live_mode,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
