
-- Function: archive individual messages older than p_days, keeping the most recent
-- p_keep_recent messages per phone in the active table so the chat UI always has
-- something to show without hitting the archive on first load.
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
      m.phone_number,
      ROW_NUMBER() OVER (PARTITION BY m.phone_number ORDER BY m.created_at DESC) AS rn
    FROM public.whatsapp_messages m
    WHERE m.created_at < (now() - make_interval(days => p_days))
  ),
  candidates AS (
    SELECT id, phone_number
    FROM ranked
    WHERE rn > p_keep_recent
    LIMIT p_batch_size
  ),
  -- Skip messages belonging to phones with active orders
  filtered AS (
    SELECT c.id, c.phone_number
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE regexp_replace(coalesce(o.phone, ''), '\D', '', 'g') LIKE
            '%' || right(regexp_replace(c.phone_number, '\D', '', 'g'), 8)
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
    RETURNING id, phone_number
  )
  SELECT count(*), count(DISTINCT phone_number) INTO v_archived, v_phones FROM inserted;

  RETURN QUERY SELECT v_archived, v_phones;
END;
$$;

-- Schedule nightly run at 04:30 UTC (30 days, batch 20k, keep 20 recent per phone)
SELECT cron.schedule(
  'archive-individual-messages-30d',
  '30 4 * * *',
  $$ SELECT public.archive_old_messages_individual(30, 20000, 20); $$
);
