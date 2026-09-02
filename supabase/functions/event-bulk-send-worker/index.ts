// Worker da fila de envios em massa por evento (Template API / Cross-sell).
// Claim atômico (SKIP LOCKED), envio sequencial com pausa, retry limitado.
// Acionado logo após o enqueue e por cron a cada minuto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { isTerminalSendError } from "../_shared/automation-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const BATCH = 25;
const LOCK_SECONDS = 120;
const MAX_ATTEMPTS = 3;
const DELAY_MS = 1200;
const RUN_BUDGET_MS = 50_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let sent = 0, failed = 0, retried = 0;
    const touchedSends = new Set<string>();

    while (Date.now() - started < RUN_BUDGET_MS) {
      const { data: items, error } = await supabase.rpc("claim_event_bulk_send_items", {
        p_limit: BATCH,
        p_lock_seconds: LOCK_SECONDS,
      });
      if (error) throw error;
      if (!items || items.length === 0) break;

      for (const it of items as Array<{
        id: string; send_id: string; phone: string; whatsapp_number_id: string | null;
        components: unknown[]; attempts: number;
      }>) {
        if (Date.now() - started > RUN_BUDGET_MS) break;
        touchedSends.add(it.send_id);

        const { data: send } = await supabase
          .from("event_bulk_sends")
          .select("template_name, template_language, status")
          .eq("id", it.send_id)
          .maybeSingle();
        if (!send || send.status === "cancelled") {
          await supabase.from("event_bulk_send_items")
            .update({ status: "skipped", reason: "disparo cancelado", locked_until: null })
            .eq("id", it.id);
          continue;
        }

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/meta-whatsapp-send-template`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: it.phone,
              templateName: send.template_name,
              language: send.template_language || "pt_BR",
              whatsappNumberId: it.whatsapp_number_id || undefined,
              components: Array.isArray(it.components) && it.components.length > 0 ? it.components : undefined,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.error) {
            const detail = data?.details?.error?.message || data?.error || `HTTP ${res.status}`;
            throw new Error(`(${res.status}) ${String(detail).slice(0, 300)}`);
          }
          await supabase.from("event_bulk_send_items")
            .update({ status: "sent", message_id: data?.messageId || null, sent_at: new Date().toISOString(), locked_until: null, reason: null })
            .eq("id", it.id);
          sent++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const terminal = isTerminalSendError(msg) || (it.attempts || 0) >= MAX_ATTEMPTS;
          if (terminal) {
            await supabase.from("event_bulk_send_items")
              .update({ status: "failed", reason: msg.slice(0, 500), locked_until: null })
              .eq("id", it.id);
            failed++;
          } else {
            // libera para nova tentativa em ~1 min
            await supabase.from("event_bulk_send_items")
              .update({ reason: msg.slice(0, 500), locked_until: new Date(Date.now() + 60_000).toISOString() })
              .eq("id", it.id);
            retried++;
          }
        }

        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    for (const id of touchedSends) {
      await supabase.rpc("refresh_event_bulk_send_counts", { p_send_id: id });
    }
    // Disparos sem itens pendentes que ficaram em queued/processing
    const { data: stale } = await supabase
      .from("event_bulk_sends")
      .select("id")
      .in("status", ["queued", "processing"])
      .lt("updated_at", new Date(Date.now() - 2 * 60_000).toISOString())
      .limit(20);
    for (const s of stale || []) {
      await supabase.rpc("refresh_event_bulk_send_counts", { p_send_id: (s as { id: string }).id });
    }

    // Auto-encadeamento: enquanto houver itens pendentes, o worker se reinvoca
    // (sem cron por minuto). Itens em retry esperam até o lock expirar.
    const { data: nextPending } = await supabase
      .from("event_bulk_send_items")
      .select("locked_until")
      .eq("status", "pending")
      .order("locked_until", { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();
    if (nextPending) {
      const lockedUntil = nextPending.locked_until ? new Date(nextPending.locked_until).getTime() : 0;
      const waitMs = Math.min(Math.max(lockedUntil - Date.now(), 1500), 65_000);
      const chain = (async () => {
        await new Promise((r) => setTimeout(r, waitMs));
        await fetch(`${SUPABASE_URL}/functions/v1/event-bulk-send-worker`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ chained: true }),
        }).catch(() => {});
      })();
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(chain); else chain.catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, retried, sends: touchedSends.size, more: !!nextPending }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[event-bulk-send-worker]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
