
ALTER TABLE public.chat_finished_conversations
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid;

ALTER TABLE public.chat_finished_conversations
  ADD COLUMN IF NOT EXISTS instance_key uuid
  GENERATED ALWAYS AS (COALESCE(whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

DROP INDEX IF EXISTS public.idx_chat_finished_phone;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_finished_phone_instance
  ON public.chat_finished_conversations (phone, instance_key);

CREATE INDEX IF NOT EXISTS idx_cfc_suffix_instance
  ON public.chat_finished_conversations ("right"(regexp_replace(phone, '[^0-9]', '', 'g'), 8), instance_key, finished_at);

-- Resolver finalizadas: agora devolve também a instância
DROP FUNCTION IF EXISTS public.resolve_finished_conversations(text[]);
CREATE OR REPLACE FUNCTION public.resolve_finished_conversations(p_keys text[])
RETURNS TABLE(phone_key text, instance_key uuid, finished_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT "right"(regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) AS phone_key,
         c.instance_key,
         max(c.finished_at) AS finished_at
  FROM public.chat_finished_conversations c
  WHERE "right"(regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) = ANY(p_keys)
  GROUP BY 1, 2
$function$;

-- Reabrir: apenas a instância informada (null = todas, comportamento antigo)
CREATE OR REPLACE FUNCTION public.reopen_finished_conversation(p_phone text, p_whatsapp_number_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_suffix text;
  v_count integer;
BEGIN
  v_suffix := right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 8);

  DELETE FROM chat_finished_conversations
  WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
    AND (
      p_whatsapp_number_id IS NULL
      OR instance_key = p_whatsapp_number_id
      OR whatsapp_number_id IS NULL  -- registros antigos (sem instância) valem para todas
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Reabertura automática ao receber/enviar mensagem: só a instância da mensagem
CREATE OR REPLACE FUNCTION public.auto_reopen_finished_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_suffix text;
  v_inst uuid;
BEGIN
  v_suffix := right(regexp_replace(NEW.phone, '[^0-9]', '', 'g'), 8);

  IF v_suffix IS NULL OR v_suffix = '' THEN
    RETURN NEW;
  END IF;

  v_inst := COALESCE(NEW.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_finished_conversations
    WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
      AND finished_at < NEW.created_at
      AND (whatsapp_number_id IS NULL OR instance_key = v_inst)
  ) THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.chat_finished_conversations
  WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix
    AND finished_at < NEW.created_at
    AND (whatsapp_number_id IS NULL OR instance_key = v_inst);

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_finished_conversations(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.reopen_finished_conversation(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_finished_conversations(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_finished_conversation(text, uuid) TO authenticated, service_role;
