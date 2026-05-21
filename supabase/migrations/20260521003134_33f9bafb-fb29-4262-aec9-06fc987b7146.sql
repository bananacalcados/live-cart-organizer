
CREATE OR REPLACE FUNCTION public.archive_old_messages_individual(
  p_days integer DEFAULT 30,
  p_batch_size integer DEFAULT 10000,
  p_keep_recent integer DEFAULT 20
)
RETURNS TABLE(archived_count bigint, affected_phones bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_archived bigint := 0;
  v_phones bigint := 0;
BEGIN
  WITH ranked AS (
    SELECT
      m.id,
      m.phone,
      ROW_NUMBER() OVER (PARTITION BY m.phone ORDER BY m.created_at DESC) AS rn
    FROM public.whatsapp_messages m
    WHERE m.created_at < (now() - make_interval(days => p_days))
  ),
  candidates AS (
    SELECT id, phone
    FROM ranked
    WHERE rn > p_keep_recent
    LIMIT p_batch_size
  ),
  filtered AS (
    SELECT c.id, c.phone
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE regexp_replace(coalesce(o.phone, ''), '\D', '', 'g') LIKE
            '%' || right(regexp_replace(c.phone, '\D', '', 'g'), 8)
        AND coalesce(o.status, '') NOT IN ('delivered','cancelled','refunded')
    )
  ),
  moved AS (
    DELETE FROM public.whatsapp_messages m
    USING filtered f
    WHERE m.id = f.id
    RETURNING m.*
  ),
  inserted AS (
    INSERT INTO public.whatsapp_messages_archive
    SELECT * FROM moved
    ON CONFLICT (id) DO NOTHING
    RETURNING id, phone
  )
  SELECT count(*), count(DISTINCT phone) INTO v_archived, v_phones FROM inserted;

  RETURN QUERY SELECT v_archived, v_phones;
END;
$$;
