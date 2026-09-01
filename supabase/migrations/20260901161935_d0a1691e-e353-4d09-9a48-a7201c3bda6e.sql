CREATE OR REPLACE FUNCTION public.resolve_finished_conversations(p_keys text[])
RETURNS TABLE (phone_key text, finished_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT "right"(regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) AS phone_key,
         max(c.finished_at) AS finished_at
  FROM public.chat_finished_conversations c
  WHERE "right"(regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) = ANY(p_keys)
  GROUP BY 1
$$;

REVOKE ALL ON FUNCTION public.resolve_finished_conversations(text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_finished_conversations(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_finished_conversations(text[]) TO service_role;