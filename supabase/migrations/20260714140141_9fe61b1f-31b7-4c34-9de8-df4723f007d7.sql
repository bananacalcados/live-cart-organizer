
-- 1) Colunas de temperatura em customers_unified
ALTER TABLE public.customers_unified
  ADD COLUMN IF NOT EXISTS lead_temperature text,
  ADD COLUMN IF NOT EXISTS temperature_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_engagement_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_engagement_type text,
  ADD COLUMN IF NOT EXISTS dispatch_total_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_reacted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_ignored_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.customers_unified
  DROP CONSTRAINT IF EXISTS customers_unified_lead_temperature_check;
ALTER TABLE public.customers_unified
  ADD CONSTRAINT customers_unified_lead_temperature_check
  CHECK (lead_temperature IS NULL OR lead_temperature IN ('muito_quente','quente','morno','frio','inerte'));

CREATE INDEX IF NOT EXISTS idx_customers_unified_lead_temperature
  ON public.customers_unified(lead_temperature)
  WHERE lead_temperature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_unified_last_engagement_at
  ON public.customers_unified(last_engagement_at DESC NULLS LAST);

-- 2) Função de recálculo (SECURITY DEFINER; agrega por sufixo DDD+8)
CREATE OR REPLACE FUNCTION public.recalculate_lead_temperature()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  v_started timestamptz := clock_timestamp();
  v_counts jsonb;
BEGIN
  -- Agrega sinais por sufixo (DDD+8) uma única vez
  CREATE TEMP TABLE IF NOT EXISTS _lead_sig (
    suffix8 text PRIMARY KEY,
    last_reply_at timestamptz,
    last_read_at timestamptz,
    dispatch_total integer,
    dispatch_reacted integer,
    funnel_last_at timestamptz
  ) ON COMMIT DROP;

  TRUNCATE _lead_sig;

  -- Respostas inbound (últimos 180 dias basta para a matriz)
  INSERT INTO _lead_sig (suffix8, last_reply_at)
  SELECT right(regexp_replace(phone,'\D','','g'),8), max(created_at)
  FROM whatsapp_messages
  WHERE direction = 'incoming'
    AND created_at > now() - interval '180 days'
    AND phone IS NOT NULL
  GROUP BY 1
  ON CONFLICT (suffix8) DO UPDATE SET last_reply_at = EXCLUDED.last_reply_at;

  -- Disparos: total, reacted (read) e last_read_at
  INSERT INTO _lead_sig (suffix8, last_read_at, dispatch_total, dispatch_reacted)
  SELECT
    right(regexp_replace(phone,'\D','','g'),8),
    max(sent_at) FILTER (WHERE status = 'read'),
    count(*) FILTER (WHERE status IN ('sent','delivered','read','failed')),
    count(*) FILTER (WHERE status = 'read')
  FROM dispatch_recipients
  WHERE phone IS NOT NULL
    AND COALESCE(sent_at, created_at) > now() - interval '365 days'
  GROUP BY 1
  ON CONFLICT (suffix8) DO UPDATE SET
    last_read_at = EXCLUDED.last_read_at,
    dispatch_total = EXCLUDED.dispatch_total,
    dispatch_reacted = EXCLUDED.dispatch_reacted;

  -- Entradas recentes em funis de lead
  INSERT INTO _lead_sig (suffix8, funnel_last_at)
  SELECT suffix8, max(created_at) FROM (
    SELECT right(regexp_replace(phone,'\D','','g'),8) suffix8, created_at
      FROM lp_leads WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
    UNION ALL
    SELECT right(regexp_replace(phone,'\D','','g'),8), created_at
      FROM event_leads WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
    UNION ALL
    SELECT right(regexp_replace(phone,'\D','','g'),8), created_at
      FROM ad_leads WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
  ) f
  GROUP BY 1
  ON CONFLICT (suffix8) DO UPDATE SET funnel_last_at = EXCLUDED.funnel_last_at;

  -- Atualiza customers_unified em lote
  WITH calc AS (
    SELECT
      cu.id,
      cu.tags AS old_tags,
      cu.total_orders,
      s.last_reply_at,
      s.last_read_at,
      COALESCE(s.dispatch_total, 0) AS d_total,
      COALESCE(s.dispatch_reacted, 0) AS d_reacted,
      s.funnel_last_at,
      GREATEST(s.last_reply_at, s.last_read_at) AS last_eng_at,
      CASE
        WHEN s.last_reply_at IS NOT NULL
             AND (s.last_read_at IS NULL OR s.last_reply_at >= s.last_read_at)
          THEN 'replied'
        WHEN s.last_read_at IS NOT NULL THEN 'read'
        WHEN COALESCE(s.dispatch_total,0) > 0 THEN 'delivered'
        ELSE 'none'
      END AS last_eng_type
    FROM customers_unified cu
    LEFT JOIN _lead_sig s ON s.suffix8 = cu.phone_suffix8
    WHERE cu.phone_suffix8 IS NOT NULL
  ),
  scored AS (
    SELECT
      id, old_tags, total_orders, last_eng_at, last_eng_type,
      d_total, d_reacted,
      GREATEST(0, d_total - d_reacted) AS d_ignored,
      CASE
        WHEN last_reply_at >= now() - interval '15 days'
             OR funnel_last_at >= now() - interval '7 days'
          THEN 'muito_quente'
        WHEN last_reply_at >= now() - interval '45 days'
             OR last_read_at  >= now() - interval '30 days'
             OR funnel_last_at >= now() - interval '30 days'
          THEN 'quente'
        WHEN last_read_at  >= now() - interval '90 days'
             OR last_reply_at >= now() - interval '90 days'
          THEN 'morno'
        WHEN d_total >= 3 AND d_reacted = 0
          THEN 'inerte'
        WHEN d_total > 0
          THEN 'frio'
        ELSE 'frio'
      END AS temp
    FROM calc
  ),
  tagged AS (
    SELECT
      id, last_eng_at, last_eng_type, d_total, d_reacted, d_ignored, temp,
      (
        -- preserva tags manuais (sem prefixos gerenciados) e injeta os novos
        COALESCE(ARRAY(
          SELECT t FROM unnest(COALESCE(old_tags, ARRAY[]::text[])) t
          WHERE t NOT LIKE 'engaja:%'
            AND t NOT LIKE 'lead:%'
            AND t NOT LIKE 'cliente:%'
            AND t NOT LIKE 'convertido:%'
            AND t <> 'bloqueou'
        ), ARRAY[]::text[])
        ||
        ARRAY[
          CASE last_eng_type
            WHEN 'replied' THEN 'engaja:responde'
            WHEN 'read' THEN 'engaja:le'
            WHEN 'delivered' THEN 'engaja:ignora'
            ELSE NULL
          END,
          CASE
            WHEN total_orders > 0 AND temp IN ('muito_quente','quente') THEN 'cliente:ativo'
            WHEN total_orders > 0 AND temp = 'morno' THEN 'cliente:em_risco'
            WHEN total_orders > 0 AND temp IN ('frio','inerte') THEN 'cliente:perdido'
            WHEN total_orders = 0 AND temp IN ('muito_quente','quente') THEN 'lead:reativo'
            WHEN total_orders = 0 THEN 'lead:novo'
            ELSE NULL
          END
        ]::text[]
      ) AS new_tags
    FROM scored
  )
  UPDATE customers_unified cu
  SET
    lead_temperature = t.temp,
    last_engagement_at = t.last_eng_at,
    last_engagement_type = t.last_eng_type,
    dispatch_total_count = t.d_total,
    dispatch_reacted_count = t.d_reacted,
    dispatch_ignored_count = t.d_ignored,
    temperature_updated_at = now(),
    tags = ARRAY(SELECT DISTINCT x FROM unnest(t.new_tags) x WHERE x IS NOT NULL)
  FROM tagged t
  WHERE cu.id = t.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT jsonb_object_agg(lead_temperature, cnt) INTO v_counts
  FROM (
    SELECT lead_temperature, count(*) cnt
    FROM customers_unified
    WHERE lead_temperature IS NOT NULL
    GROUP BY 1
  ) x;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'segments', COALESCE(v_counts, '{}'::jsonb),
    'duration_ms', extract(millisecond FROM clock_timestamp() - v_started)::int
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_lead_temperature() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_lead_temperature() TO authenticated, service_role;

-- 3) Agenda diária (03:15 America/Sao_Paulo ≈ 06:15 UTC)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('recalculate-lead-temperature-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'recalculate-lead-temperature-daily',
  '15 6 * * *',
  $$ SELECT public.recalculate_lead_temperature(); $$
);
