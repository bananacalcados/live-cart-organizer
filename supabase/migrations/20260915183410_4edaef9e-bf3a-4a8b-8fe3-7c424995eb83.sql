CREATE OR REPLACE FUNCTION public.auto_reopen_finished_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_suffix text;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'incoming' OR NEW.whatsapp_number_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_suffix := right(regexp_replace(NEW.phone, '[^0-9]', '', 'g'), 8);
  IF v_suffix IS NULL OR v_suffix = '' THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.chat_finished_conversations
  WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
    AND finished_at < NEW.created_at
    AND whatsapp_number_id = NEW.whatsapp_number_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_finished_conversation(p_phone text, p_whatsapp_number_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_suffix text;
  v_count integer := 0;
BEGIN
  IF p_whatsapp_number_id IS NULL THEN
    RETURN 0;
  END IF;

  v_suffix := right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 8);
  IF v_suffix IS NULL OR v_suffix = '' THEN
    RETURN 0;
  END IF;

  DELETE FROM public.chat_finished_conversations
  WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
    AND whatsapp_number_id = p_whatsapp_number_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

INSERT INTO public.chat_finished_conversations (
  phone,
  finished_at,
  finished_by,
  created_at,
  finish_reason,
  seller_id,
  sale_value,
  sale_currency,
  trigger_id,
  purchased,
  support_reason,
  support_satisfactory,
  duvida_text,
  whatsapp_number_id
)
SELECT DISTINCT ON (legacy.phone, conv.whatsapp_number_id)
  legacy.phone,
  legacy.finished_at,
  legacy.finished_by,
  legacy.created_at,
  legacy.finish_reason,
  legacy.seller_id,
  legacy.sale_value,
  legacy.sale_currency,
  legacy.trigger_id,
  legacy.purchased,
  legacy.support_reason,
  legacy.support_satisfactory,
  legacy.duvida_text,
  conv.whatsapp_number_id
FROM public.chat_finished_conversations legacy
JOIN public.whatsapp_conversations conv
  ON right(regexp_replace(conv.phone, '[^0-9]', '', 'g'), 8)
   = right(regexp_replace(legacy.phone, '[^0-9]', '', 'g'), 8)
WHERE legacy.whatsapp_number_id IS NULL
  AND conv.whatsapp_number_id IS NOT NULL
ORDER BY legacy.phone, conv.whatsapp_number_id, legacy.finished_at DESC
ON CONFLICT (phone, instance_key) DO UPDATE SET
  finished_at = GREATEST(public.chat_finished_conversations.finished_at, EXCLUDED.finished_at),
  finished_by = COALESCE(EXCLUDED.finished_by, public.chat_finished_conversations.finished_by),
  finish_reason = COALESCE(EXCLUDED.finish_reason, public.chat_finished_conversations.finish_reason),
  seller_id = COALESCE(EXCLUDED.seller_id, public.chat_finished_conversations.seller_id),
  sale_value = COALESCE(EXCLUDED.sale_value, public.chat_finished_conversations.sale_value),
  sale_currency = COALESCE(EXCLUDED.sale_currency, public.chat_finished_conversations.sale_currency),
  trigger_id = COALESCE(EXCLUDED.trigger_id, public.chat_finished_conversations.trigger_id),
  purchased = COALESCE(EXCLUDED.purchased, public.chat_finished_conversations.purchased),
  support_reason = COALESCE(EXCLUDED.support_reason, public.chat_finished_conversations.support_reason),
  support_satisfactory = COALESCE(EXCLUDED.support_satisfactory, public.chat_finished_conversations.support_satisfactory),
  duvida_text = COALESCE(EXCLUDED.duvida_text, public.chat_finished_conversations.duvida_text);

DELETE FROM public.chat_finished_conversations
WHERE whatsapp_number_id IS NULL;

REVOKE ALL ON FUNCTION public.reopen_finished_conversation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_finished_conversation(text, uuid) TO authenticated, service_role;