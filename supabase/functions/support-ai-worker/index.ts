import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authenticateCronRequest } from "../_shared/cron-auth.ts";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";
import { withAccessLog } from "../_shared/withAccessLog.ts";
Deno.serve(withAccessLog("support-ai-worker", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (authenticateCronRequest(req) && !(await isAuthorizedCron(req))) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response("Configuração indisponível", { status: 500, headers: corsHeaders });
  const sb = createClient(url, key); const lease = crypto.randomUUID();
  const { data, error } = await sb.rpc("support_cost_worker_claim", { p_lease: lease });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  let processed = 0;
  try {
    for (const s of data ?? []) {
      const res = await fetch(`${url}/functions/v1/support-ai-agent`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ suggestion_id: s.id }) });
      if (!res.ok) {
        await sb.from("support_auto_suggestions").update({ status: "ignorada", ai_error: `worker_http_${res.status}`, reason: "falha_worker_sem_retentativa" }).eq("id", s.id).eq("status", "processando");
      }
      await res.text(); processed++;
    }
  } finally { await sb.rpc("support_cost_worker_finish", { p_lease: lease }); }
  return new Response(JSON.stringify({ processed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}));