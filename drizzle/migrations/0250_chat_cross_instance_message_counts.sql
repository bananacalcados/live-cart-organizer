CREATE OR REPLACE FUNCTION public.chat_cross_instance_message_counts(p_phone text)
RETURNS TABLE(whatsapp_number_id uuid, message_count integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH raw AS (
    SELECT regexp_replace(COALESCE(p_phone, ''), '\\D', '', 'g') AS digits
  ), local_phone AS (
    SELECT CASE
      WHEN digits ~ '^55' AND length(digits) IN (12, 13) THEN substr(digits, 3)
      ELSE digits
    END AS value
    FROM raw
  ), variants AS (
    SELECT ARRAY(SELECT DISTINCT unnest(ARRAY[
      value,
      '55' || value,
      left(value, 2) || '9' || right(value, 8),
      '55' || left(value, 2) || '9' || right(value, 8),
      left(value, 2) || right(value, 8),
      '55' || left(value, 2) || right(value, 8)
    ])) AS phones
    FROM local_phone
    WHERE length(value) IN (10, 11)
  )
  SELECT wm.whatsapp_number_id, count(*)::integer AS message_count
  FROM public.whatsapp_messages wm
  CROSS JOIN variants v
  WHERE wm.phone = ANY(v.phones)
    AND wm.whatsapp_number_id IS NOT NULL
  GROUP BY wm.whatsapp_number_id
  ORDER BY message_count DESC, wm.whatsapp_number_id
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.chat_cross_instance_message_counts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_cross_instance_message_counts(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chat_cross_instance_message_counts(text) TO authenticated;