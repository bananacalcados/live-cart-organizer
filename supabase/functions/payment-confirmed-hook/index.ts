import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { notifyPaymentConfirmed } from "../_shared/payment-confirmed.ts";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  try {
    const payload = await req.json();
    const orderId = payload?.pedido_id || payload?.orderId;

    if (!orderId) {
      return new Response(JSON.stringify({ error: "pedido_id is required" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("payment-confirmed-hook error:", message);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
