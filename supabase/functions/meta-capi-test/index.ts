// Helper de teste pra disparar manualmente um envio Purchase pra Meta CAPI Offline.
// Apenas pra validação interna — usa META_CAPI_INTERNAL_SECRET pra chamar a função real.
// Não expõe nada sensível ao chamador.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const saleId = body?.sale_id;

    if (!saleId || typeof saleId !== "string") {
      return new Response(JSON.stringify({ error: "sale_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const INTERNAL_SECRET = Deno.env.get("META_CAPI_INTERNAL_SECRET");

    if (!INTERNAL_SECRET) {
      return new Response(
        JSON.stringify({ error: "META_CAPI_INTERNAL_SECRET not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Chama a edge function real usando o secret interno
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/meta-capi-offline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ sale_id: saleId, source: "manual_test" }),
    });

    const respJson = await resp.json().catch(() => ({}));

    return new Response(
      JSON.stringify({
        ok: resp.ok,
        status: resp.status,
        meta_capi_response: respJson,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
