// Teste temporário de autenticação da chave AustPay/Rinne em produção.
// Faz UMA chamada de leitura (GET /v1/transactions) e devolve status + trecho
// da resposta. Nunca devolve a chave.
import { getAustpayConfig, austpayFetch, AUSTPAY_SANDBOX_BASE, AUSTPAY_PROD_BASE } from "../_shared/austpay.ts";

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
    const results: any = {};
    for (const which of ["sandbox", "production"] as const) {
      const alt = { ...cfg, baseUrl: which === "production" ? AUSTPAY_PROD_BASE : AUSTPAY_SANDBOX_BASE };
      const r = await austpayFetch(alt, "/v1/transactions?limit=1", { method: "GET" });
      const t = await r.text();
      results[which] = { status: r.status, ok: r.ok, body: t.slice(0, 400) };
    }
    return new Response(JSON.stringify({
      provider: cfg.provider,
      hasMerchant: !!cfg.merchantId,
      results,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
