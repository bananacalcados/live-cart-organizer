// Cron: verifica status de conexão de todas as instâncias Z-API ativas
// e atualiza whatsapp_numbers.is_online + last_health_check.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Permite checar 1 instância específica via body
  let singleId: string | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (body?.instanceId) singleId = body.instanceId;
  } catch { /* ignore */ }

  const query = supabase
    .from("whatsapp_numbers")
    .select("id, label, provider, zapi_instance_id, zapi_token, zapi_client_token")
    .eq("provider", "zapi")
    .eq("is_active", true);

  if (singleId) query.eq("id", singleId);

  const { data: instances, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; label: string; online: boolean; error?: string }> = [];

  await Promise.all((instances || []).map(async (inst) => {
    if (!inst.zapi_instance_id || !inst.zapi_token || !inst.zapi_client_token) {
      await supabase
        .from("whatsapp_numbers")
        .update({
          is_online: false,
          last_health_check: new Date().toISOString(),
          health_check_error: "missing_credentials",
        })
        .eq("id", inst.id);
      results.push({ id: inst.id, label: inst.label, online: false, error: "missing_credentials" });
      return;
    }
    try {
      const url = `https://api.z-api.io/instances/${inst.zapi_instance_id}/token/${inst.zapi_token}/status`;
      const r = await fetch(url, {
        method: "GET",
        headers: { "Client-Token": inst.zapi_client_token },
        signal: AbortSignal.timeout(8000),
      });
      const data = await r.json().catch(() => ({}));
      const online = r.ok && (data?.connected === true || data?.smartphoneConnected === true);
      const errMsg = !online ? (data?.error || data?.message || `status_${r.status}`) : null;

      await supabase
        .from("whatsapp_numbers")
        .update({
          is_online: online,
          last_health_check: new Date().toISOString(),
          health_check_error: errMsg,
        })
        .eq("id", inst.id);

      results.push({ id: inst.id, label: inst.label, online, error: errMsg || undefined });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("whatsapp_numbers")
        .update({
          is_online: false,
          last_health_check: new Date().toISOString(),
          health_check_error: msg,
        })
        .eq("id", inst.id);
      results.push({ id: inst.id, label: inst.label, online: false, error: msg });
    }
  }));

  return new Response(JSON.stringify({ checked: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
