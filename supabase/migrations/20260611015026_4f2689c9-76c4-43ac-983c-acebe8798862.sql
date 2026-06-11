GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_seller_assignments TO authenticated;
GRANT ALL ON public.chat_seller_assignments TO service_role;

CREATE OR REPLACE FUNCTION public.get_pos_whatsapp_dashboard(
  p_store_id text,
  p_days int DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text := 'America/Sao_Paulo';
  v_start timestamptz;
  v_has_store_numbers boolean;
  v_incoming bigint;
  v_outgoing bigint;
  v_conversations bigint;
  v_responded bigint;
  v_avg_minutes numeric;
  v_evolution jsonb;
  v_hourly jsonb;
  v_heatmap jsonb;
BEGIN
  v_start := (date_trunc('day', (now() AT TIME ZONE v_tz)) - make_interval(days => p_days)) AT TIME ZONE v_tz;

  SELECT EXISTS(SELECT 1 FROM pos_store_whatsapp_numbers WHERE store_id = p_store_id)
    INTO v_has_store_numbers;

  CREATE TEMP TABLE _msgs ON COMMIT DROP AS
  SELECT
    m.phone,
    m.direction,
    m.created_at,
    (m.created_at AT TIME ZONE v_tz) AS local_ts
  FROM whatsapp_messages m
  WHERE m.created_at >= v_start
    AND COALESCE(m.is_group, false) = false
    AND (
      NOT v_has_store_numbers
      OR m.whatsapp_number_id IS NULL
      OR m.whatsapp_number_id IN (
        SELECT whatsapp_number_id FROM pos_store_whatsapp_numbers WHERE store_id = p_store_id
      )
    );

  SELECT
    count(*) FILTER (WHERE direction = 'incoming'),
    count(*) FILTER (WHERE direction = 'outgoing')
    INTO v_incoming, v_outgoing
  FROM _msgs;

  WITH per_phone AS (
    SELECT
      phone,
      min(created_at) FILTER (WHERE direction = 'incoming') AS first_in
    FROM _msgs
    GROUP BY phone
  ),
  resp AS (
    SELECT
      p.phone,
      p.first_in,
      (SELECT min(o.created_at) FROM _msgs o
        WHERE o.phone = p.phone AND o.direction = 'outgoing' AND o.created_at >= p.first_in) AS reply_at
    FROM per_phone p
    WHERE p.first_in IS NOT NULL
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE reply_at IS NOT NULL),
    avg(EXTRACT(EPOCH FROM (reply_at - first_in)) / 60.0)
      FILTER (WHERE reply_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (reply_at - first_in)) / 60.0 BETWEEN 0 AND 1440)
    INTO v_conversations, v_responded, v_avg_minutes
  FROM resp;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', date, 'incoming', incoming, 'outgoing', outgoing) ORDER BY d), '[]'::jsonb)
    INTO v_evolution
  FROM (
    SELECT
      date_trunc('day', local_ts) AS d,
      to_char(local_ts, 'DD/MM') AS date,
      count(*) FILTER (WHERE direction = 'incoming') AS incoming,
      count(*) FILTER (WHERE direction = 'outgoing') AS outgoing
    FROM _msgs
    GROUP BY 1, 2
  ) sub;

  SELECT COALESCE(jsonb_object_agg(hour, cnt), '{}'::jsonb) INTO v_hourly
  FROM (
    SELECT EXTRACT(HOUR FROM local_ts)::int AS hour, count(*) AS cnt
    FROM _msgs
    GROUP BY 1
  ) h;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'count', cnt)), '[]'::jsonb)
    INTO v_heatmap
  FROM (
    SELECT EXTRACT(DOW FROM local_ts)::int AS dow, EXTRACT(HOUR FROM local_ts)::int AS hour, count(*) AS cnt
    FROM _msgs
    WHERE direction = 'incoming'
    GROUP BY 1, 2
  ) hm;

  RETURN jsonb_build_object(
    'incoming', COALESCE(v_incoming, 0),
    'outgoing', COALESCE(v_outgoing, 0),
    'conversations', COALESCE(v_conversations, 0),
    'response_rate', CASE WHEN COALESCE(v_conversations, 0) > 0
      THEN round((v_responded::numeric / v_conversations) * 100) ELSE 0 END,
    'avg_response_minutes', v_avg_minutes,
    'evolution', v_evolution,
    'hourly', v_hourly,
    'heatmap', v_heatmap
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_whatsapp_dashboard(text, int) TO authenticated, service_role, anon;