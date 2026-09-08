CREATE OR REPLACE FUNCTION public.chat_lane_clear_on_incoming()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := right(regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g'), 8);
  IF length(v_key) < 8 THEN RETURN NEW; END IF;
  DELETE FROM public.chat_conversation_lanes
   WHERE phone_key = v_key
     AND lane <> 'support';
  RETURN NEW;
END;
$$;