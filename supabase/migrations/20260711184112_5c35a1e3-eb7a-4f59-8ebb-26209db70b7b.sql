
-- Facet counts for CRM audience builders (server-side aggregation)
CREATE OR REPLACE FUNCTION public.crm_facet_counts(p_column text)
RETURNS TABLE(value text, cnt bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_column NOT IN ('rfm_segment','state','city','region_type','gender') THEN
    RAISE EXCEPTION 'invalid column: %', p_column;
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT (%1$I)::text AS value, count(*)::bigint AS cnt
       FROM public.crm_customers_v
      WHERE (%1$I) IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC',
    p_column
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_facet_counts(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_facet_counts(text) TO service_role;

-- Lead campaign counts (server-side aggregation)
CREATE OR REPLACE FUNCTION public.lead_campaign_counts()
RETURNS TABLE(value text, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT campaign_tag::text AS value, count(*)::bigint AS cnt
    FROM public.lp_leads
   WHERE campaign_tag IS NOT NULL
   GROUP BY 1
   ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.lead_campaign_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_campaign_counts() TO service_role;

-- Extend conversation counts cache freshness window (20s -> 60s)
CREATE OR REPLACE FUNCTION public.get_conversation_counts()
RETURNS TABLE(awaiting_count bigint, new_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_awaiting bigint;
  v_new bigint;
  v_updated timestamptz;
BEGIN
  SELECT c.awaiting_count, c.new_count, c.updated_at
    INTO v_awaiting, v_new, v_updated
    FROM conversation_counts_cache c
    WHERE c.id = 1;

  -- Cache fresco: retorna imediatamente.
  IF v_updated IS NOT NULL AND v_updated > now() - interval '60 seconds' THEN
    awaiting_count := v_awaiting;
    new_count := v_new;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Cache obsoleto: somente uma sessão recalcula; as demais devolvem o último valor.
  IF NOT pg_try_advisory_xact_lock(927312001) THEN
    awaiting_count := COALESCE(v_awaiting, 0);
    new_count := COALESCE(v_new, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      phone,
      (array_agg(direction ORDER BY created_at DESC))[1] AS last_direction,
      max(created_at) AS last_created,
      bool_or(direction = 'outgoing') AS has_outgoing
    FROM whatsapp_messages
    WHERE created_at > now() - interval '90 days'
    GROUP BY phone
  ),
  finished AS (
    SELECT DISTINCT ON (phone) phone, finished_at
    FROM chat_finished_conversations
    ORDER BY phone, finished_at DESC
  ),
  active AS (
    SELECT a.has_outgoing
    FROM agg a
    LEFT JOIN finished f ON f.phone = a.phone
    WHERE a.last_direction = 'incoming'
      AND (f.finished_at IS NULL OR f.finished_at < a.last_created)
  )
  SELECT
    COUNT(*) FILTER (WHERE has_outgoing),
    COUNT(*) FILTER (WHERE NOT has_outgoing)
  INTO v_awaiting, v_new
  FROM active;

  UPDATE conversation_counts_cache
    SET awaiting_count = v_awaiting,
        new_count = v_new,
        updated_at = now()
    WHERE id = 1;

  awaiting_count := v_awaiting;
  new_count := v_new;
  RETURN NEXT;
  RETURN;
END;
$function$;
