import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cron interno: aceita chamada com service-role key OU anon key (pg_cron injeta
// um desses headers). A operação só remove arquivos de status com +48h — não
// toca em dados vivos — então esse nível de proteção é suficiente.
function isInternalRequest(req: Request, serviceKey: string, anonKey: string): boolean {
  const auth = req.headers.get("Authorization") || "";
  const key = req.headers.get("apikey") || "";
  return (
    auth === `Bearer ${serviceKey}` ||
    key === serviceKey ||
    auth === `Bearer ${anonKey}` ||
    key === anonKey
  );
}

const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!isInternalRequest(req, serviceKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const now = Date.now();
    let deleted = 0;

    // Lista as pastas por dia dentro de status/ e remove arquivos com +48h.
    const { data: dayFolders, error: listErr } = await supabase.storage
      .from("whatsapp-media")
      .list("status", { limit: 1000 });
    if (listErr) throw listErr;

    for (const folder of dayFolders || []) {
      // ignora entradas que não sejam pastas de dia
      if (folder.id) continue;
      const prefix = `status/${folder.name}`;
      const { data: files } = await supabase.storage
        .from("whatsapp-media")
        .list(prefix, { limit: 1000 });

      const toRemove: string[] = [];
      for (const f of files || []) {
        const created = f.created_at ? new Date(f.created_at).getTime() : 0;
        if (created && now - created > MAX_AGE_MS) {
          toRemove.push(`${prefix}/${f.name}`);
        }
      }
      if (toRemove.length) {
        const { error: rmErr } = await supabase.storage.from("whatsapp-media").remove(toRemove);
        if (!rmErr) deleted += toRemove.length;
      }
    }

    return new Response(JSON.stringify({ success: true, deleted }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("cleanup-status-media error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
