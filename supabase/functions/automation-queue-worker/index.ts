// automation-queue-worker
// Consome public.automation_message_queue de forma SEQUENCIAL, com espaçamento
// + jitter e teto global de mensagens/minuto. Rodado por pg_cron a cada minuto.
//
// Nenhuma automação fala direto com a Cloud API: o continue-flow enfileira e
// este worker envia no ritmo controlado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { sendAutomationJob, isTerminalSendError } from "../_shared/automation-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 120;
const RUN_BUDGET_MS = 50_000;

// Teto global folgado (não travar respostas de live). Ajustável em app_settings.
const DEFAULT_PER_MINUTE = 60;
const DEFAULT_JITTER_MIN_MS = 250;
const DEFAULT_JITTER_MAX_MS = 900;

// Etapa 2 — ritmo por contato
const DEFAULT_MIN_GAP_SECONDS = 45;        // intervalo mínimo entre msgs p/ o mesmo contato
const DEFAULT_ACTIVE_GAP_SECONDS = 10;     // cliente respondeu recentemente → conversa ativa
const DEFAULT_ACTIVE_WINDOW_MIN = 30;      // janela que define "conversa ativa"
const DEFAULT_DAILY_CAP = 8;
const DEFAULT_WEEKLY_CAP = 20;
const DEFAULT_QUIET_START = 22;            // 22h
const DEFAULT_QUIET_END = 8;               // 08h
const MAX_RESCHEDULES = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readSetting(supabase: any, key: string, fallback: number): Promise<number> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
    const n = Number(data?.value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch (_e) {
    return fallback;
  }
}

/** Hora atual em São Paulo (0-23). */
function spHour(d = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(d),
  ) % 24;
}

function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Próximo instante fora da janela de silêncio (início do horário permitido em SP). */
function nextAllowedAfterQuiet(end: number): Date {
  const now = new Date();
  for (let i = 0; i <= 48; i++) {
    const cand = new Date(now.getTime() + i * 30 * 60 * 1000);
    if (spHour(cand) === end) return cand;
  }
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/** Reagenda um job sem consumir tentativa. */
async function reschedule(
  supabase: any,
  job: any,
  when: Date,
  reason: string,
) {
  await supabase
    .from("automation_message_queue")
    .update({
      status: "pending",
      locked_by: null,
      locked_until: null,
      scheduled_at: when.toISOString(),
      attempts: Math.max(0, (job.attempts || 1) - 1),
      reschedule_count: (job.reschedule_count || 0) + 1,
      last_error: reason,
    })
    .eq("id", job.id);
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);

  const supabase = createClient(supabaseUrl, serviceKey);
  const workerId = `w-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();

  try {
    // Pausa de emergência global (usada nas próximas etapas / operação manual)
    const { data: paused } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "automation_queue_paused")
      .maybeSingle();
    if (paused?.value === "true" || paused?.value === true) {
      return new Response(JSON.stringify({ success: true, paused: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const perMinute = await readSetting(supabase, "automation_queue_per_minute", DEFAULT_PER_MINUTE);
    const jitterMin = await readSetting(supabase, "automation_queue_jitter_min_ms", DEFAULT_JITTER_MIN_MS);
    const jitterMax = await readSetting(supabase, "automation_queue_jitter_max_ms", DEFAULT_JITTER_MAX_MS);
    const baseGapMs = Math.floor(60_000 / perMinute);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    while (Date.now() - startedAt < RUN_BUDGET_MS && sent + failed + skipped < perMinute) {
      const batchSize = Math.min(20, perMinute - (sent + failed + skipped));
      const { data: jobs, error: claimErr } = await supabase.rpc("claim_automation_queue_jobs", {
        p_worker_id: workerId,
        p_batch_size: batchSize,
        p_lease_seconds: LEASE_SECONDS,
        p_max_attempts: MAX_ATTEMPTS,
      });

      if (claimErr) {
        console.error("[automation-queue-worker] claim error:", claimErr);
        break;
      }
      if (!jobs || jobs.length === 0) break;

      for (const job of jobs as any[]) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) {
          // devolve para a fila sem consumir tentativa extra
          await supabase
            .from("automation_message_queue")
            .update({ status: "pending", locked_by: null, locked_until: null, attempts: Math.max(0, (job.attempts || 1) - 1) })
            .eq("id", job.id);
          continue;
        }

        // Contato bloqueado / opt-out → skip
        const { data: blocked } = await supabase
          .from("blocked_contacts")
          .select("id")
          .eq("phone", job.phone)
          .limit(1);
        if (blocked && blocked.length > 0) {
          await supabase
            .from("automation_message_queue")
            .update({ status: "skipped", last_error: "blocked_contact", locked_by: null, locked_until: null })
            .eq("id", job.id);
          skipped++;
          continue;
        }

        try {
          await sendAutomationJob(
            { supabaseUrl, serviceKey, supabase },
            job.phone,
            job.whatsapp_number_id,
            job.payload,
          );
          await supabase
            .from("automation_message_queue")
            .update({ status: "sent", sent_at: new Date().toISOString(), locked_by: null, locked_until: null, last_error: null })
            .eq("id", job.id);
          sent++;

          if (job.flow_id) {
            await supabase.from("automation_executions").insert({
              flow_id: job.flow_id,
              step_id: job.step_id,
              status: "success",
              result: { phone: job.phone, action: `queue_${job.payload?.kind}`, queued: true },
            });
          }
        } catch (err) {
          const msg = String(err);
          const terminal = isTerminalSendError(msg) || (job.attempts || 1) >= MAX_ATTEMPTS;
          await supabase
            .from("automation_message_queue")
            .update({
              status: terminal ? "failed" : "pending",
              last_error: msg.slice(0, 500),
              locked_by: null,
              locked_until: null,
              // backoff simples quando ainda há retry
              scheduled_at: terminal
                ? job.scheduled_at
                : new Date(Date.now() + 3 * 60 * 1000 * (job.attempts || 1)).toISOString(),
            })
            .eq("id", job.id);
          failed++;
          console.error(`[automation-queue-worker] job ${job.id} failed (terminal=${terminal}):`, msg);
        }

        const jitter = jitterMin + Math.random() * Math.max(0, jitterMax - jitterMin);
        await sleep(baseGapMs + jitter);
      }
    }

    const { data: pending } = await supabase.rpc("automation_queue_pending_count");

    return new Response(JSON.stringify({ success: true, worker: workerId, sent, failed, skipped, pending: pending ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[automation-queue-worker] fatal:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
