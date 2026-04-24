// Helper público pra disparar o backfill OFFLINE (usa service role internamente).
// Útil quando você não tem acesso ao secret/vault e precisa rodar manualmente.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

  let body: any = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const days = Math.max(1, Math.min(365, Number(body?.days ?? 90)));
  const dryRun = body?.dry_run !== false;
  const limit = Math.max(1, Math.min(10000, Number(body?.limit ?? 5000)));

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/meta-capi-offline-backfill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ days, dry_run: dryRun, limit }),
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
