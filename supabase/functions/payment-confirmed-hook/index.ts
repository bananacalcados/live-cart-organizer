import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { notifyPaymentConfirmed } from "../_shared/payment-confirmed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const orderId = payload?.pedido_id || payload?.orderId;

    if (!orderId) {
      return new Response(JSON.stringify({ error: "pedido_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await notifyPaymentConfirmed({
      pedido_id: String(orderId),
      loja: payload?.loja || "centro",
      gateway: payload?.gateway || null,
      transaction_id: payload?.transaction_id || null,
      source: payload?.source || "frontend",
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("payment-confirmed-hook error:", message);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
