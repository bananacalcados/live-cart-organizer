
CREATE OR REPLACE FUNCTION public.archive_inactive_broadcast_messages(
  p_days integer DEFAULT 15,
  p_batch_size integer DEFAULT 5000
)
RETURNS TABLE(archived_phones integer, archived_messages integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_phones text[];
  v_msgs_count integer := 0;
BEGIN
  SELECT array_agg(phone) INTO v_phones
  FROM (
    SELECT phone
    FROM public.whatsapp_messages
    GROUP BY phone
    HAVING MAX(created_at) < v_cutoff
       AND bool_and(direction = 'outgoing' AND source = 'broadcast')
       AND COUNT(*) > 0
    LIMIT p_batch_size
  ) sub
  WHERE phone NOT IN (
    SELECT DISTINCT regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')
    FROM public.customers c
    JOIN public.orders o ON o.customer_id = c.id
    WHERE o.stage NOT IN ('delivered', 'cancelled', 'refunded')
      AND coalesce(whatsapp, '') <> ''
  );

  IF v_phones IS NULL OR array_length(v_phones, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  WITH moved AS (
    DELETE FROM public.whatsapp_messages
    WHERE phone = ANY(v_phones)
    RETURNING id, phone, message, direction, message_id, status, created_at,
              media_type, media_url, is_group, whatsapp_number_id, sender_name,
              error_code, error_message, channel, is_mass_dispatch, referral,
              sender_user_id, quoted_message_id, source
  )
  INSERT INTO public.whatsapp_messages_archive (
    id, phone, message, direction, message_id, status, created_at,
    media_type, media_url, is_group, whatsapp_number_id, sender_name,
    error_code, error_message, channel, is_mass_dispatch, referral,
    sender_user_id, quoted_message_id, source
  )
  SELECT id, phone, message, direction, message_id, status, created_at,
         media_type, media_url, is_group, whatsapp_number_id, sender_name,
         error_code, error_message, channel, is_mass_dispatch, referral,
         sender_user_id, quoted_message_id, source
  FROM moved
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_msgs_count = ROW_COUNT;
  RETURN QUERY SELECT array_length(v_phones, 1), v_msgs_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_inactive_ads_conversations(
  p_days integer DEFAULT 30,
  p_batch_size integer DEFAULT 5000
)
RETURNS TABLE(archived_phones integer, archived_messages integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_phones text[];
  v_msgs_count integer := 0;
BEGIN
  SELECT array_agg(phone) INTO v_phones
  FROM (
    SELECT phone
    FROM public.whatsapp_messages
    GROUP BY phone
    HAVING MAX(created_at) < v_cutoff
       AND bool_or(
         source = 'ads_lead'
         OR (referral IS NOT NULL AND referral ? 'ctwa_clid')
       )
    LIMIT p_batch_size
  ) sub
  WHERE phone NOT IN (
    SELECT DISTINCT regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')
    FROM public.customers c
    JOIN public.orders o ON o.customer_id = c.id
    WHERE o.stage NOT IN ('delivered', 'cancelled', 'refunded')
      AND coalesce(whatsapp, '') <> ''
  );

  IF v_phones IS NULL OR array_length(v_phones, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  WITH moved AS (
    DELETE FROM public.whatsapp_messages
    WHERE phone = ANY(v_phones)
    RETURNING id, phone, message, direction, message_id, status, created_at,
              media_type, media_url, is_group, whatsapp_number_id, sender_name,
              error_code, error_message, channel, is_mass_dispatch, referral,
              sender_user_id, quoted_message_id, source
  )
  INSERT INTO public.whatsapp_messages_archive (
    id, phone, message, direction, message_id, status, created_at,
    media_type, media_url, is_group, whatsapp_number_id, sender_name,
    error_code, error_message, channel, is_mass_dispatch, referral,
    sender_user_id, quoted_message_id, source
  )
  SELECT id, phone, message, direction, message_id, status, created_at,
         media_type, media_url, is_group, whatsapp_number_id, sender_name,
         error_code, error_message, channel, is_mass_dispatch, referral,
         sender_user_id, quoted_message_id, source
  FROM moved
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_msgs_count = ROW_COUNT;
  RETURN QUERY SELECT array_length(v_phones, 1), v_msgs_count;
END;
$$;
