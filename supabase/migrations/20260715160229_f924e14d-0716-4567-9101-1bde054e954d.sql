
-- ============================================================
-- Etapa A: Score de disparo unificado (compra + mensagem)
-- Aditivo. Não altera lead_temperature nem filtros salvos.
-- ============================================================

-- 1) Colunas novas em customers_unified
ALTER TABLE public.customers_unified
  ADD COLUMN IF NOT EXISTS classificacao_disparo text,
  ADD COLUMN IF NOT EXISTS classificacao_disparo_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_consecutive_ignored integer NOT NULL DEFAULT 0;

ALTER TABLE public.customers_unified
  DROP CONSTRAINT IF EXISTS customers_unified_classificacao_disparo_check;
ALTER TABLE public.customers_unified
  ADD CONSTRAINT customers_unified_classificacao_disparo_check
  CHECK (classificacao_disparo IS NULL
    OR classificacao_disparo IN ('quente','morno','frio','silencio'));

CREATE INDEX IF NOT EXISTS idx_customers_unified_classificacao_disparo
  ON public.customers_unified(classificacao_disparo)
  WHERE classificacao_disparo IS NOT NULL;

-- 2) Tabela de cotas / gatilhos configuráveis (usada já para silencio_threshold;
--    cota_mensal e tipos_permitidos serão consumidos na Etapa B)
CREATE TABLE IF NOT EXISTS public.dispatch_touch_limits (
  classificacao text PRIMARY KEY
    CHECK (classificacao IN ('quente','morno','frio','silencio')),
  cota_mensal integer NOT NULL DEFAULT 0,
  tipos_permitidos text[] NOT NULL DEFAULT ARRAY[]::text[],
  silencio_threshold_ignorados integer,   -- só usado na linha 'silencio'
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dispatch_touch_limits TO authenticated;
GRANT ALL ON public.dispatch_touch_limits TO service_role;

ALTER TABLE public.dispatch_touch_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read touch limits" ON public.dispatch_touch_limits;
CREATE POLICY "authenticated read touch limits"
  ON public.dispatch_touch_limits FOR SELECT
  TO authenticated USING (true);

-- Seeds (idempotentes)
INSERT INTO public.dispatch_touch_limits (classificacao, cota_mensal, tipos_permitidos, silencio_threshold_ignorados, observacoes)
VALUES
  ('quente',   4, ARRAY['convite_live','oferta','lancamento','reativacao','pesquisa'], NULL, 'Comprou <=90d ou interagiu <=30d'),
  ('morno',    2, ARRAY['convite_live','oferta','pesquisa'], NULL, 'Alternar convite_live e oferta — evitar ambos na mesma semana (regra aplicada na Etapa B)'),
  ('frio',     1, ARRAY['reativacao','lancamento','pesquisa'], NULL, 'Sem convite genérico de live'),
  ('silencio', 0, ARRAY[]::text[], 4, 'Sai da rotação até dar sinal de vida (compra, resposta ou clique). Threshold: 4 disparos ignorados seguidos.')
ON CONFLICT (classificacao) DO NOTHING;

-- 3) Estende recalculate_lead_temperature() para também gravar
--    classificacao_disparo + dispatch_consecutive_ignored.
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
  v_counts_disp jsonb;
  v_silence_threshold integer;
BEGIN
  SELECT COALESCE(silencio_threshold_ignorados, 4) INTO v_silence_threshold
  FROM public.dispatch_touch_limits WHERE classificacao = 'silencio';
  IF v_silence_threshold IS NULL THEN v_silence_threshold := 4; END IF;

  -- ---- Agrega sinais por sufixo (DDD+8) ----
  CREATE TEMP TABLE IF NOT EXISTS _lead_sig (
    suffix8 text PRIMARY KEY,
    last_reply_at timestamptz,
    last_read_at timestamptz,
    dispatch_total integer,
    dispatch_reacted integer,
    funnel_last_at timestamptz,
    consecutive_ignored integer
  ) ON COMMIT DROP;

  TRUNCATE _lead_sig;

  INSERT INTO _lead_sig (suffix8, last_reply_at)
  SELECT right(regexp_replace(phone,'\D','','g'),8), max(created_at)
  FROM whatsapp_messages
  WHERE direction = 'incoming'
    AND created_at > now() - interval '180 days'
    AND phone IS NOT NULL
  GROUP BY 1
  ON CONFLICT (suffix8) DO UPDATE SET last_reply_at = EXCLUDED.last_reply_at;

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

  -- ---- Streak de ignorados consecutivos ----
  -- Conta disparos com status IN ('sent','delivered') após o último "sinal de vida"
  -- (leitura de disparo, resposta inbound OU compra registrada em customers_unified).
  WITH anchors AS (
    SELECT
      cu.phone_suffix8 AS suffix8,
      GREATEST(
        COALESCE(s.last_reply_at, 'epoch'::timestamptz),
        COALESCE(s.last_read_at,  'epoch'::timestamptz),
        COALESCE(cu.last_purchase_at, 'epoch'::timestamptz)
      ) AS anchor_at
    FROM customers_unified cu
    LEFT JOIN _lead_sig s ON s.suffix8 = cu.phone_suffix8
    WHERE cu.phone_suffix8 IS NOT NULL
  ),
  streak AS (
    SELECT
      right(regexp_replace(dr.phone,'\D','','g'),8) AS suffix8,
      count(*) AS ignored_after
    FROM dispatch_recipients dr
    JOIN anchors a ON a.suffix8 = right(regexp_replace(dr.phone,'\D','','g'),8)
    WHERE dr.phone IS NOT NULL
      AND dr.status IN ('sent','delivered')
      AND COALESCE(dr.sent_at, dr.created_at) > a.anchor_at
      AND COALESCE(dr.sent_at, dr.created_at) > now() - interval '365 days'
    GROUP BY 1
  )
  UPDATE _lead_sig ls
  SET consecutive_ignored = st.ignored_after
  FROM streak st
  WHERE ls.suffix8 = st.suffix8;

  -- ---- Update principal ----
  WITH calc AS (
    SELECT
      cu.id,
      cu.tags AS old_tags,
      cu.total_orders,
      cu.last_purchase_at,
      s.last_reply_at,
      s.last_read_at,
      COALESCE(s.dispatch_total, 0) AS d_total,
      COALESCE(s.dispatch_reacted, 0) AS d_reacted,
      COALESCE(s.consecutive_ignored, 0) AS d_ign_streak,
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
      c.*,
      GREATEST(0, d_total - d_reacted) AS d_ignored,
      -- Temperatura legada (regra original preservada)
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
      END AS temp,
      -- Classificação de disparo NOVA (compra + mensagem)
      CASE
        -- Silêncio: streak >= threshold E sem sinal recente
        WHEN d_ign_streak >= v_silence_threshold
             AND (last_purchase_at IS NULL OR last_purchase_at < now() - interval '180 days')
             AND (last_reply_at    IS NULL OR last_reply_at    < now() - interval '90 days')
          THEN 'silencio'
        -- Quente: comprou <=90d OU interagiu (respondeu/leu) <=30d
        WHEN last_purchase_at >= now() - interval '90 days'
             OR last_reply_at >= now() - interval '30 days'
             OR last_read_at  >= now() - interval '30 days'
          THEN 'quente'
        -- Morno: comprou 90..180d OU lead sem compra captado <=60d
        WHEN (last_purchase_at >= now() - interval '180 days'
              AND last_purchase_at <  now() - interval '90 days')
             OR (COALESCE(total_orders,0) = 0
                 AND funnel_last_at >= now() - interval '60 days')
          THEN 'morno'
        ELSE 'frio'
      END AS disp
    FROM calc c
  ),
  tagged AS (
    SELECT
      id, last_eng_at, last_eng_type, d_total, d_reacted, d_ignored, d_ign_streak, temp, disp,
      (
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
    tags = ARRAY(SELECT DISTINCT x FROM unnest(t.new_tags) x WHERE x IS NOT NULL),
    classificacao_disparo = t.disp,
    classificacao_disparo_updated_at = now(),
    dispatch_consecutive_ignored = t.d_ign_streak
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

  SELECT jsonb_object_agg(classificacao_disparo, cnt) INTO v_counts_disp
  FROM (
    SELECT classificacao_disparo, count(*) cnt
    FROM customers_unified
    WHERE classificacao_disparo IS NOT NULL
    GROUP BY 1
  ) y;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'segments', COALESCE(v_counts, '{}'::jsonb),
    'classificacao_disparo', COALESCE(v_counts_disp, '{}'::jsonb),
    'silence_threshold', v_silence_threshold,
    'duration_ms', extract(millisecond FROM clock_timestamp() - v_started)::int
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_lead_temperature() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_lead_temperature() TO authenticated, service_role;

-- 4) Simulação read-only (não altera nada) — usa mesma lógica da classificação nova
CREATE OR REPLACE FUNCTION public.simulate_classificacao_disparo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_silence_threshold integer;
BEGIN
  SELECT COALESCE(silencio_threshold_ignorados, 4) INTO v_silence_threshold
  FROM public.dispatch_touch_limits WHERE classificacao = 'silencio';
  IF v_silence_threshold IS NULL THEN v_silence_threshold := 4; END IF;

  WITH sig AS (
    SELECT
      right(regexp_replace(phone,'\D','','g'),8) AS suffix8,
      max(created_at) FILTER (WHERE direction = 'incoming') AS last_reply_at
    FROM whatsapp_messages
    WHERE phone IS NOT NULL
      AND created_at > now() - interval '180 days'
    GROUP BY 1
  ),
  reads AS (
    SELECT
      right(regexp_replace(phone,'\D','','g'),8) AS suffix8,
      max(sent_at) FILTER (WHERE status='read') AS last_read_at,
      count(*) FILTER (WHERE status='read') AS reacted
    FROM dispatch_recipients
    WHERE phone IS NOT NULL
      AND COALESCE(sent_at, created_at) > now() - interval '365 days'
    GROUP BY 1
  ),
  funnel AS (
    SELECT suffix8, max(created_at) AS funnel_last_at FROM (
      SELECT right(regexp_replace(phone,'\D','','g'),8) suffix8, created_at
        FROM lp_leads WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
      UNION ALL
      SELECT right(regexp_replace(phone,'\D','','g'),8), created_at
        FROM event_leads WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
      UNION ALL
      SELECT right(regexp_replace(phone,'\D','','g'),8), created_at
        FROM ad_leads WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
    ) f GROUP BY 1
  ),
  anchors AS (
    SELECT
      cu.id, cu.phone_suffix8 AS suffix8, cu.total_orders, cu.last_purchase_at,
      sig.last_reply_at, reads.last_read_at, funnel.funnel_last_at,
      GREATEST(
        COALESCE(sig.last_reply_at, 'epoch'::timestamptz),
        COALESCE(reads.last_read_at, 'epoch'::timestamptz),
        COALESCE(cu.last_purchase_at, 'epoch'::timestamptz)
      ) AS anchor_at
    FROM customers_unified cu
    LEFT JOIN sig    ON sig.suffix8    = cu.phone_suffix8
    LEFT JOIN reads  ON reads.suffix8  = cu.phone_suffix8
    LEFT JOIN funnel ON funnel.suffix8 = cu.phone_suffix8
    WHERE cu.phone_suffix8 IS NOT NULL
  ),
  streaks AS (
    SELECT
      a.id,
      count(dr.id) AS d_ign_streak
    FROM anchors a
    LEFT JOIN dispatch_recipients dr
      ON dr.phone IS NOT NULL
     AND right(regexp_replace(dr.phone,'\D','','g'),8) = a.suffix8
     AND dr.status IN ('sent','delivered')
     AND COALESCE(dr.sent_at, dr.created_at) > a.anchor_at
     AND COALESCE(dr.sent_at, dr.created_at) > now() - interval '365 days'
    GROUP BY a.id
  ),
  classed AS (
    SELECT
      a.id,
      CASE
        WHEN COALESCE(s.d_ign_streak,0) >= v_silence_threshold
             AND (a.last_purchase_at IS NULL OR a.last_purchase_at < now() - interval '180 days')
             AND (a.last_reply_at    IS NULL OR a.last_reply_at    < now() - interval '90 days')
          THEN 'silencio'
        WHEN a.last_purchase_at >= now() - interval '90 days'
             OR a.last_reply_at >= now() - interval '30 days'
             OR a.last_read_at  >= now() - interval '30 days'
          THEN 'quente'
        WHEN (a.last_purchase_at >= now() - interval '180 days'
              AND a.last_purchase_at <  now() - interval '90 days')
             OR (COALESCE(a.total_orders,0) = 0
                 AND a.funnel_last_at >= now() - interval '60 days')
          THEN 'morno'
        ELSE 'frio'
      END AS disp
    FROM anchors a
    LEFT JOIN streaks s ON s.id = a.id
  )
  SELECT jsonb_build_object(
    'silence_threshold', v_silence_threshold,
    'total', (SELECT count(*) FROM classed),
    'por_classe', COALESCE(
      (SELECT jsonb_object_agg(disp, cnt) FROM (
        SELECT disp, count(*) cnt FROM classed GROUP BY 1
      ) x), '{}'::jsonb),
    'delta_vs_atual', COALESCE(
      (SELECT jsonb_object_agg(status, cnt) FROM (
        SELECT
          CASE
            WHEN cu.classificacao_disparo IS NULL AND c.disp IS NOT NULL THEN 'novo:'||c.disp
            WHEN cu.classificacao_disparo IS DISTINCT FROM c.disp
              THEN cu.classificacao_disparo||' -> '||c.disp
            ELSE 'inalterado'
          END AS status,
          count(*) cnt
        FROM classed c
        JOIN customers_unified cu ON cu.id = c.id
        GROUP BY 1
      ) d), '{}'::jsonb),
    'gerado_em', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.simulate_classificacao_disparo() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.simulate_classificacao_disparo() TO authenticated, service_role;
