-- lovable-cron-fallback-reviewed: 96 runs/day; entrega de lembretes agendados (cashback 21 dias) exige varredura temporal; 15 min limita o atraso sem custo excessivo
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'automation-pos-followups-cron';

    PERFORM cron.schedule(
      'automation-pos-followups-cron',
      '*/15 * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/automation-pos-followups-cron',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT value FROM public.internal_function_secrets WHERE key = 'cron_secret' LIMIT 1)
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  END IF;
END $$;

ALTER TABLE public.automation_pos_followups
  ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE INDEX IF NOT EXISTS idx_automation_pos_followups_due
  ON public.automation_pos_followups (scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;