
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
  active_phones AS (
    SELECT DISTINCT right(regexp_replace(c.whatsapp, '\D', '', 'g'), 8) AS suffix
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE coalesce(o.stage, '') NOT IN ('completed','cancelled','shipped')
      AND c.whatsapp IS NOT NULL
  ),
  filtered AS (
    SELECT cd.id
    FROM candidates cd
    WHERE right(regexp_replace(cd.phone, '\D', '', 'g'), 8) NOT IN (SELECT suffix FROM active_phones)
  ),
  moved AS (
    DELETE FROM public.whatsapp_messages m
    USING filtered f
    WHERE m.id = f.id
    RETURNING m.*
  ),
  inserted AS (
    INSERT INTO public.whatsapp_messages_archive (
      id, phone, message, direction, message_id, status, created_at,
      media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral,
      sender_user_id, quoted_message_id, source, archived_at
    )
    SELECT
      id, phone, message, direction, message_id, status, created_at,
      media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral,
      sender_user_id, quoted_message_id, source, now()
    FROM moved
    ON CONFLICT (id) DO NOTHING
    RETURNING id, phone
  )
  SELECT count(*), count(DISTINCT phone) INTO v_archived, v_phones FROM inserted;

  RETURN QUERY SELECT v_archived, v_phones;
END;
$$;
