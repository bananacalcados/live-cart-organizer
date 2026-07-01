CREATE OR REPLACE FUNCTION public.search_all_conversations(p_query text)
RETURNS TABLE(
  phone text,
  whatsapp_number_id uuid,
  instance_label text,
  sender_name text,
  last_message text,
  last_message_at timestamptz,
  message_count bigint,
  is_finished boolean,
  is_archived boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_suffix text := CASE WHEN length(v_digits) >= 8 THEN right(v_digits, 8) ELSE v_digits END;
BEGIN
  IF length(coalesce(p_query, '')) < 3 THEN
    RETURN;
  END IF;

  IF length(v_digits) >= 4 THEN
    RETURN QUERY
    WITH matched AS (
      SELECT m.phone, m.whatsapp_number_id, m.message, m.created_at, m.sender_name,
             row_number() OVER (PARTITION BY m.phone, m.whatsapp_number_id ORDER BY m.created_at DESC) AS rn,
             count(*) OVER (PARTITION BY m.phone, m.whatsapp_number_id) AS cnt
      FROM whatsapp_messages m
      WHERE m.is_group IS NOT TRUE
        AND (m.phone LIKE '%' || v_digits || '%' OR m.phone LIKE '%' || v_suffix || '%')
    )
    SELECT mt.phone::text, mt.whatsapp_number_id, wn.label::text, mt.sender_name::text,
           mt.message::text, mt.created_at, mt.cnt,
           EXISTS(SELECT 1 FROM chat_finished_conversations f WHERE f.phone = mt.phone),
           EXISTS(SELECT 1 FROM chat_archived_conversations a WHERE a.phone = mt.phone)
    FROM matched mt
    LEFT JOIN whatsapp_numbers wn ON wn.id = mt.whatsapp_number_id
    WHERE mt.rn = 1
    ORDER BY mt.created_at DESC
    LIMIT 100;
  ELSE
    RETURN QUERY
    WITH matched AS (
      SELECT m.phone, m.whatsapp_number_id, m.message, m.created_at, m.sender_name,
             row_number() OVER (PARTITION BY m.phone, m.whatsapp_number_id ORDER BY m.created_at DESC) AS rn,
             count(*) OVER (PARTITION BY m.phone, m.whatsapp_number_id) AS cnt
      FROM whatsapp_messages m
      WHERE m.is_group IS NOT TRUE
        AND m.sender_name ILIKE '%' || p_query || '%'
    )
    SELECT mt.phone::text, mt.whatsapp_number_id, wn.label::text, mt.sender_name::text,
           mt.message::text, mt.created_at, mt.cnt,
           EXISTS(SELECT 1 FROM chat_finished_conversations f WHERE f.phone = mt.phone),
           EXISTS(SELECT 1 FROM chat_archived_conversations a WHERE a.phone = mt.phone)
    FROM matched mt
    LEFT JOIN whatsapp_numbers wn ON wn.id = mt.whatsapp_number_id
    WHERE mt.rn = 1
    ORDER BY mt.created_at DESC
    LIMIT 100;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_all_conversations(text) TO authenticated;