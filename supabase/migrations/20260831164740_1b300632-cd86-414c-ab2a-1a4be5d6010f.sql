DROP INDEX IF EXISTS public.idx_wm_phone_number_created;
DROP INDEX IF EXISTS public.idx_whatsapp_messages_mass_dispatch_message_id;

CREATE INDEX IF NOT EXISTS idx_cfc_phone_suffix
  ON public.chat_finished_conversations ((right(regexp_replace(phone, '[^0-9]', '', 'g'), 8)), finished_at);

CREATE OR REPLACE FUNCTION public.auto_reopen_finished_conversation_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_suffix text;
BEGIN
  v_suffix := right(regexp_replace(NEW.phone, '[^0-9]', '', 'g'), 8);

  IF v_suffix IS NULL OR v_suffix = '' THEN
    RETURN NEW;
  END IF;

  -- Saída rápida: na esmagadora maioria das mensagens não há conversa finalizada
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_finished_conversations
    WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
      AND finished_at < NEW.created_at
  ) THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.chat_finished_conversations
  WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
    AND finished_at < NEW.created_at;

  RETURN NEW;
END;
$function$;