-- 1) Desativa configs de follow-up duplicadas (mesmo evento/canal/atraso/gatilho/mensagem)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY event_id, channel, delay_minutes, trigger_source,
                        coalesce(btrim(message_text),''), coalesce(template_name,'')
           ORDER BY created_at
         ) AS rn
  FROM public.event_followup_configs
  WHERE enabled = true
)
UPDATE public.event_followup_configs c
SET enabled = false
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

-- 2) Cancela disparos pendentes ligados a configs desativadas
UPDATE public.event_followup_dispatches d
SET status = 'skipped', skip_reason = 'duplicate_config'
FROM public.event_followup_configs c
WHERE c.id = d.config_id AND c.enabled = false AND d.status = 'pending';

-- 3) Impede recriar configs duplicadas
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_followup_configs_dedupe
ON public.event_followup_configs (
  event_id, channel, delay_minutes, trigger_source,
  coalesce(btrim(message_text),''), coalesce(template_name,'')
) WHERE enabled = true;