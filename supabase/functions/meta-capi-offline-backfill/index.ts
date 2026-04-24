// Backfill de eventos Purchase OFFLINE pra Meta CAPI
// Reusa a edge function `meta-capi-offline` pra cada venda elegível dos últimos N dias.
//
// Modos:
//   - dry_run=true  → conta vendas, mostra amostra, NÃO envia
//   - dry_run=false → envia em lotes com pausa, retorna estatísticas
//
// Auth: SOMENTE Bearer SERVICE_ROLE_KEY (chamado manualmente, nunca exposto)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const BATCH_SIZE = 25;          // envios paralelos por lote
const PAUSE_MS = 1500;          // pausa entre lotes (rate limit Meta)

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const INTERNAL_SECRET = Deno.env.get("META_CAPI_INTERNAL_SECRET") || "";
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const internalSecretHeader = req.headers.get("X-Internal-Secret") || "";
  const isServiceRole = SERVICE_ROLE_KEY && auth === SERVICE_ROLE_KEY;
  const isInternalCall = INTERNAL_SECRET && internalSecretHeader === INTERNAL_SECRET;
  if (!isServiceRole && !isInternalCall) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(365, Number(body?.days ?? 90)));
    const dryRun = body?.dry_run !== false; // default = true (segurança)
    const limit = Math.max(1, Math.min(10000, Number(body?.limit ?? 5000)));

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE_KEY);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // 1) Busca vendas elegíveis
    const { data: sales, error: salesErr } = await supabase
      .from("pos_sales")
      .select("id, total, status, created_at, paid_at, customer_id, customer_name, customer_phone")
      .in("status", ["paid", "completed"])
      .gte("created_at", cutoff)
      .gt("total", 0)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (salesErr) throw new Error(`pos_sales query: ${salesErr.message}`);
    const allSales = sales || [];

    // 2) Filtra as que já foram enviadas com sucesso
    const saleIds = allSales.map((s) => s.id);
    const { data: alreadySent } = await supabase
      .from("meta_capi_offline_log")
      .select("sale_id, status")
      .in("sale_id", saleIds)
      .eq("event_name", "Purchase")
      .in("status", ["sent", "pending"]);

    const sentSet = new Set((alreadySent || []).map((r) => r.sale_id));
    const pending = allSales.filter((s) => !sentSet.has(s.id));

    // 3) Estatísticas / amostra
    const stats = {
      window_days: days,
      cutoff_date: cutoff,
      total_sales_in_window: allSales.length,
      already_sent_or_pending: sentSet.size,
      eligible_to_send: pending.length,
      missing_customer_id: pending.filter((s) => !s.customer_id && !s.customer_phone).length,
      total_value_brl: Number(pending.reduce((acc, s) => acc + Number(s.total || 0), 0).toFixed(2)),
    };

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        mode: "dry_run",
        stats,
        sample_first_5: pending.slice(0, 5).map((s) => ({
          sale_id: s.id,
          total: s.total,
          status: s.status,
          paid_at: s.paid_at || s.created_at,
          has_customer: !!s.customer_id,
        })),
        next_step: "Chame de novo com { \"dry_run\": false } pra enviar de verdade.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4) Envio real em lotes paralelos
    const results = { sent: 0, errors: 0, skipped: 0, error_messages: [] as string[] };

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (sale) => {
        try {
          const resp = await fetch(`${FUNCTIONS_BASE}/meta-capi-offline`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ sale_id: sale.id }),
          });
          const json: any = await resp.json().catch(() => ({}));
          if (resp.ok && json?.ok) {
            if (json.skipped) results.skipped++;
            else results.sent++;
          } else {
            results.errors++;
            if (results.error_messages.length < 10) {
              results.error_messages.push(`${sale.id}: ${json?.error || `HTTP ${resp.status}`}`);
            }
          }
        } catch (e) {
          results.errors++;
          if (results.error_messages.length < 10) {
            results.error_messages.push(`${sale.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      await Promise.all(promises);
      if (i + BATCH_SIZE < pending.length) await sleep(PAUSE_MS);
    }

    return new Response(JSON.stringify({
      ok: true,
      mode: "send",
      stats,
      results,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
