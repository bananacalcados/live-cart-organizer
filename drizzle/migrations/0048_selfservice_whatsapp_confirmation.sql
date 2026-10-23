ALTER TABLE public.live_selfservice_accesses
  ADD COLUMN IF NOT EXISTS confirm_code text,
  ADD COLUMN IF NOT EXISTS whatsapp_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_phone text,
  ADD COLUMN IF NOT EXISTS confirmed_phone_key text,
  ADD COLUMN IF NOT EXISTS confirmed_number_id uuid,
  ADD COLUMN IF NOT EXISTS confirm_message_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS live_selfservice_accesses_confirm_code_uq
  ON public.live_selfservice_accesses (confirm_code) WHERE confirm_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS live_selfservice_accesses_confirmed_key_idx
  ON public.live_selfservice_accesses (event_id, confirmed_phone_key) WHERE confirmed_phone_key IS NOT NULL;

-- Casa a mensagem "já preenchi meu cadastro #CODIGO" com o acesso do autoatendimento.
CREATE OR REPLACE FUNCTION public.live_selfservice_match_incoming()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := substring(coalesce(NEW.message,'') from '#([A-Z0-9]{5})\M');
  v_acc public.live_selfservice_accesses%ROWTYPE;
  v_digits text := regexp_replace(coalesce(NEW.phone,''), '\D', '', 'g');
  v_key text;
  v_secret text;
BEGIN
  IF v_code IS NULL OR length(v_digits) < 10 THEN RETURN NEW; END IF;
  v_key := public.event_phone_key(NEW.phone);

  UPDATE public.live_selfservice_accesses
     SET whatsapp_confirmed_at = now(), confirmed_phone = v_digits, confirmed_phone_key = v_key,
         confirmed_number_id = NEW.whatsapp_number_id, confirm_message_id = NEW.id, updated_at = now(),
         metadata = metadata || CASE WHEN v_key IS DISTINCT FROM phone_key
           THEN jsonb_build_object('entered_phone_original', entered_phone, 'phone_changed_at', now()) ELSE '{}'::jsonb END
   WHERE confirm_code = v_code AND whatsapp_confirmed_at IS NULL
   RETURNING * INTO v_acc;
  IF v_acc.id IS NULL THEN RETURN NEW; END IF;

  -- Número real diferente do digitado: o WhatsApp do cliente passa a ser o remetente.
  IF v_key IS DISTINCT FROM v_acc.phone_key THEN
    IF coalesce(array_length(v_acc.order_ids,1),0) > 0 THEN
      UPDATE public.customers c SET whatsapp = v_digits, updated_at = now()
        FROM public.orders o WHERE o.id = ANY(v_acc.order_ids) AND c.id = o.customer_id
         AND regexp_replace(coalesce(c.whatsapp,''),'\D','','g') IS DISTINCT FROM v_digits;
      UPDATE public.customer_registrations SET whatsapp = v_digits
       WHERE order_id = ANY(v_acc.order_ids) AND whatsapp IS DISTINCT FROM v_digits;
    END IF;
    UPDATE public.event_leads SET phone = v_digits, phone_suffix = right(v_digits, 8),
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('self_service_entered_phone', v_acc.entered_phone)
     WHERE event_id = v_acc.event_id AND phone_suffix = right(v_acc.entered_phone, 8) AND source = 'autoatendimento';
  END IF;

  SELECT value INTO v_secret FROM public.internal_function_secrets WHERE key = 'cron_secret';
  PERFORM net.http_post(
    url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/live-selfservice',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', coalesce(v_secret,'')),
    body := jsonb_build_object('action','confirmed','access_id', v_acc.id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[live_selfservice_match_incoming] %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.live_selfservice_match_incoming() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_live_selfservice_match_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_live_selfservice_match_incoming
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'incoming' AND NEW.message LIKE '%já preenchi meu cadastro #%')
  EXECUTE FUNCTION public.live_selfservice_match_incoming();