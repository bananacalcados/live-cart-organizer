CREATE OR REPLACE FUNCTION public.auto_reopen_finished_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_suffix text;
BEGIN
  v_suffix := right(regexp_replace(NEW.phone, '[^0-9]', '', 'g'), 8);

  IF v_suffix IS NULL OR v_suffix = '' THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.chat_finished_conversations
  WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
    AND finished_at < NEW.created_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_reopen_finished_conversation_on_message ON public.whatsapp_messages;

CREATE TRIGGER trg_auto_reopen_finished_conversation_on_message
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.auto_reopen_finished_conversation_on_message();