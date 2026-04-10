CREATE OR REPLACE FUNCTION public.reopen_finished_conversation(p_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_suffix text;
  v_count integer;
BEGIN
  v_suffix := right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 8);
  
  DELETE FROM chat_finished_conversations
  WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;