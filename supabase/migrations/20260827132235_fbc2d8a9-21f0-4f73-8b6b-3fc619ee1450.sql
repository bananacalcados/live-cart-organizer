CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_wm_message_trgm_outgoing
  ON public.whatsapp_messages USING gin (message gin_trgm_ops)
  WHERE direction = 'outgoing';

CREATE OR REPLACE FUNCTION public.pos_sales_phone_by_message(p_sale_ids text[])
RETURNS TABLE(sale_id text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.sale_id, m.phone
  FROM unnest(p_sale_ids) AS s(sale_id)
  CROSS JOIN LATERAL (
    SELECT w.phone
    FROM public.whatsapp_messages w
    WHERE w.direction = 'outgoing'
      AND w.message ILIKE '%' || s.sale_id || '%'
    ORDER BY w.created_at DESC
    LIMIT 1
  ) m;
$$;

REVOKE ALL ON FUNCTION public.pos_sales_phone_by_message(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_sales_phone_by_message(text[]) TO authenticated, service_role;

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

  -- Cache fresco (5 min): retorna imediatamente.
  IF v_updated IS NOT NULL AND v_updated > now() - interval '5 minutes' THEN
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
    WHERE created_at > now() - interval '30 days'
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

DROP INDEX IF EXISTS public.idx_dispatch_recipients_dispatch_id;