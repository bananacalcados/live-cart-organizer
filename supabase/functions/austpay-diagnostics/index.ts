// Diagnóstico temporário da conta AustPay (sandbox): afiliações, chaves Pix e
// contas bancárias. Somente leitura — não cria nem altera nada.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAustpayConfig, austpayFetch } from "../_shared/austpay.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cfg = getAustpayConfig();
  if (!cfg) {
    return new Response(JSON.stringify({ error: "AustPay não configurada" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const paths = [
    "/v1/companies/me",
    "/v1/affiliations",
    "/v1/companies/me/pix-keys",
    "/v1/companies/me/bank-accounts",
    "/v1/pix/keys",
    "/v1/merchants",
  ];

  const out: Record<string, unknown> = { env: cfg.env, baseUrl: cfg.baseUrl };
  for (const p of paths) {
    try {
      const res = await austpayFetch(cfg, p);
      const text = await res.text();
      out[p] = { status: res.status, body: text.slice(0, 2000) };
    } catch (e) {
      out[p] = { error: String(e) };
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
