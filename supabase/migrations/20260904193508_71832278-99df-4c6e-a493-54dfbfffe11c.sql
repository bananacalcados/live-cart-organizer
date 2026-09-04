CREATE OR REPLACE FUNCTION public.get_pos_whatsapp_dashboard(p_store_id text, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_tz text := 'America/Sao_Paulo';
  v_start timestamptz;
  v_has_store_numbers boolean;
  v_result jsonb;
BEGIN
  v_start := (date_trunc('day', (now() AT TIME ZONE v_tz)) - make_interval(days => p_days)) AT TIME ZONE v_tz;

  SELECT EXISTS(SELECT 1 FROM pos_store_whatsapp_numbers WHERE store_id::text = p_store_id)
    INTO v_has_store_numbers;

  WITH _msgs AS MATERIALIZED (
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
          SELECT whatsapp_number_id FROM pos_store_whatsapp_numbers WHERE store_id::text = p_store_id
        )
      )
  ),
  totals AS (
    SELECT
      count(*) FILTER (WHERE direction = 'incoming') AS incoming,
      count(*) FILTER (WHERE direction = 'outgoing') AS outgoing
    FROM _msgs
  ),
  per_phone AS (
    SELECT phone, min(created_at) FILTER (WHERE direction = 'incoming') AS first_in
    FROM _msgs
    GROUP BY phone
  ),
  -- Tempo de resposta em uma única passada (join + agregação) em vez de uma
  -- subconsulta correlacionada por telefone (O(N×P), estourava o timeout).
  resp AS (
    SELECT p.phone, p.first_in, min(o.created_at) AS reply_at
    FROM per_phone p
    LEFT JOIN _msgs o
      ON o.phone = p.phone AND o.direction = 'outgoing' AND o.created_at >= p.first_in
    WHERE p.first_in IS NOT NULL
    GROUP BY p.phone, p.first_in
  ),
  resp_agg AS (
    SELECT
      count(*) AS conversations,
      count(*) FILTER (WHERE reply_at IS NOT NULL) AS responded,
      avg(EXTRACT(EPOCH FROM (reply_at - first_in)) / 60.0)
        FILTER (WHERE reply_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (reply_at - first_in)) / 60.0 BETWEEN 0 AND 1440) AS avg_minutes
    FROM resp
  ),
  evolution AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('date', date, 'incoming', incoming, 'outgoing', outgoing) ORDER BY d), '[]'::jsonb) AS j
    FROM (
      SELECT
        date_trunc('day', local_ts) AS d,
        to_char(local_ts, 'DD/MM') AS date,
        count(*) FILTER (WHERE direction = 'incoming') AS incoming,
        count(*) FILTER (WHERE direction = 'outgoing') AS outgoing
      FROM _msgs
      GROUP BY 1, 2
    ) sub
  ),
  hourly AS (
    SELECT COALESCE(jsonb_object_agg(hour, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT EXTRACT(HOUR FROM local_ts)::int AS hour, count(*) AS cnt
      FROM _msgs GROUP BY 1
    ) h
  ),
  heatmap AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'count', cnt)), '[]'::jsonb) AS j
    FROM (
      SELECT EXTRACT(DOW FROM local_ts)::int AS dow, EXTRACT(HOUR FROM local_ts)::int AS hour, count(*) AS cnt
      FROM _msgs WHERE direction = 'incoming' GROUP BY 1, 2
    ) hm
  )
  SELECT jsonb_build_object(
    'incoming', COALESCE(t.incoming, 0),
    'outgoing', COALESCE(t.outgoing, 0),
    'conversations', COALESCE(r.conversations, 0),
    'response_rate', CASE WHEN COALESCE(r.conversations, 0) > 0
      THEN round((r.responded::numeric / r.conversations) * 100) ELSE 0 END,
    'avg_response_minutes', r.avg_minutes,
    'evolution', e.j,
    'hourly', h.j,
    'heatmap', hm.j
  )
  INTO v_result
  FROM totals t, resp_agg r, evolution e, hourly h, heatmap hm;

  RETURN v_result;
END;
$function$;