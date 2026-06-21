// shopify-reconcile-cron
// Rede de segurança: a cada execução (cron), avança um cursor e reconcilia UMA
// página de variantes vinculadas chamando shopify-reconcile-stock. Quando chega
// ao fim, o cursor reseta para 0 e o ciclo recomeça. Isso garante que qualquer
// falha de sync em tempo real (rate-limit/timeout no net.http_post do trigger)
// seja corrigida automaticamente sem re-sincronizar tudo de uma vez.
//
// Estado do cursor: app_settings.key = 'shopify_reconcile_cursor', value = { offset }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE_LIMIT = 50;
const CURSOR_KEY = "shopify_reconcile_cursor";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Lê cursor atual
    const { data: cursorRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", CURSOR_KEY)
      .maybeSingle();

    const offset = Math.max(0, Number((cursorRow?.value as any)?.offset) || 0);

    // Chama a reconciliação de UMA página
    const res = await fetch(`${SUPABASE_URL}/functions/v1/shopify-reconcile-stock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
      body: JSON.stringify({ offset, limit: PAGE_LIMIT }),
    });
    const out = await res.json().catch(() => ({}));

    // Calcula próximo offset (reseta no fim do ciclo)
    const done = out?.done === true;
    const nextOffset = done ? 0 : (Number(out?.next_offset) || offset + PAGE_LIMIT);

    await supabase
      .from("app_settings")
      .upsert(
        { key: CURSOR_KEY, value: { offset: nextOffset, updated_at: new Date().toISOString() } },
        { onConflict: "key" },
      );

    console.log(
      `shopify-reconcile-cron offset=${offset} processed=${out?.processed ?? 0} updated=${out?.updated ?? 0} total=${out?.total ?? 0} done=${done} next=${nextOffset}`,
    );

    return new Response(
      JSON.stringify({ ok: true, offset, next_offset: nextOffset, done, reconcile: out }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("shopify-reconcile-cron error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
