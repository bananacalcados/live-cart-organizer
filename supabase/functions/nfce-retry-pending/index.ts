// Edge function: nfce-retry-pending
// Cron a cada 5 min. Reemite NFC-e que ficaram em status='pending_sefaz' (SEFAZ offline).
// Reinvoca nfce-emitir; se autorizar, status vira 'authorized' (nfce-emitir já cuida disso).
// Se continuar offline, agenda próximo retry com backoff (5,10,20,40,60min cap).
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRIES = 200; // ~ vários dias

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const nowIso = new Date().toISOString();
  const { data: pendings, error } = await supabase
    .from("fiscal_documents")
    .select("id, pos_sale_id, ambiente, retry_count")
    .eq("status", "pending_sefaz")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .lt("retry_count", MAX_RETRIES)
    .order("next_retry_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }

  const results: any[] = [];
  for (const doc of pendings || []) {
    if (!doc.pos_sale_id) continue;

    // Backoff exponencial: 5, 10, 20, 40, 60 (cap)
    const newCount = (doc.retry_count || 0) + 1;
    const minutes = Math.min(60, 5 * Math.pow(2, Math.min(newCount - 1, 4)));
    const nextAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    // Marca tentativa antes de chamar (idempotência se chamado em paralelo)
    await supabase.from("fiscal_documents").update({
      retry_count: newCount,
      last_retry_at: new Date().toISOString(),
      next_retry_at: nextAt,
    }).eq("id", doc.id).eq("status", "pending_sefaz");

    try {
      // Reinvoca o emit (cria NOVO fiscal_document — mas o anterior fica como histórico)
      // ⚠️ Decisão: em vez de criar duplicado, apagamos o doc antigo logo antes de reemitir
      // pra manter um único registro por venda. nfce-emitir vai recriar.
      await supabase.from("fiscal_documents").delete().eq("id", doc.id);

      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nfce-emitir`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ sale_id: doc.pos_sale_id, ambiente: doc.ambiente }),
      });
      const body = await r.json().catch(() => ({}));
      results.push({ sale_id: doc.pos_sale_id, status: r.status, ok: body?.ok, contingencia: body?.contingencia });
    } catch (e: any) {
      results.push({ sale_id: doc.pos_sale_id, error: e.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
