CREATE OR REPLACE FUNCTION public.auto_unarchive_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.direction = 'incoming' AND NEW.phone IS NOT NULL THEN
    DELETE FROM public.chat_archived_conversations a
    WHERE a.phone = NEW.phone
      AND a.archived_at < NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_unarchive_conversation ON public.whatsapp_messages;
CREATE TRIGGER trg_auto_unarchive_conversation
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.auto_unarchive_conversation_on_message();

DELETE FROM public.chat_archived_conversations a
WHERE EXISTS (
  SELECT 1 FROM public.whatsapp_messages m
  WHERE m.phone = a.phone
    AND m.direction = 'incoming'
    AND m.created_at > a.archived_at
);