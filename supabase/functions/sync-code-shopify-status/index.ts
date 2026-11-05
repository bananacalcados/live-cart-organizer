// Mantido só para o agendamento antigo: repassa para sync-shopify-mirror (caminho único).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const h of ["authorization", "apikey", "x-cron-secret", "x-internal-call"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-shopify-mirror`, {
    method: "POST", headers, body: "{}",
  });
  return new Response(await res.text(), { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
