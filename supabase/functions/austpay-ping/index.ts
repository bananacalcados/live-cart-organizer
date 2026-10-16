// Teste temporário de autenticação da chave AustPay/Rinne em produção.
// Faz UMA chamada de leitura (GET /v1/transactions) e devolve status + trecho
// da resposta. Nunca devolve a chave.
import { getAustpayConfig, austpayFetch } from "../_shared/austpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const cfg = getAustpayConfig();
    if (!cfg) {
      return new Response(JSON.stringify({ ok: false, reason: "sem chave configurada" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const res = await austpayFetch(cfg, "/v1/transactions?limit=1", { method: "GET" });
    const text = await res.text();
    return new Response(JSON.stringify({
      ok: res.ok,
      env: cfg.env,
      provider: cfg.provider,
      hasMerchant: !!cfg.merchantId,
      status: res.status,
      body: text.slice(0, 600),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
