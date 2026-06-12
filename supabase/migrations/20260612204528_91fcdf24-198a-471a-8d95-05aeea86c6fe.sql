-- PARTE 1: tabela de ingestão bruta (caixa-preta)
CREATE TABLE IF NOT EXISTS public.webhook_events_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  event_type text,
  owner text,
  payload jsonb NOT NULL,
  skip_reason text
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_raw_created ON public.webhook_events_raw (created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_raw_type ON public.webhook_events_raw (provider, event_type, created_at);

GRANT ALL ON public.webhook_events_raw TO service_role;

-- RLS: habilitar, sem policy para authenticated (só service_role acessa)
ALTER TABLE public.webhook_events_raw ENABLE ROW LEVEL SECURITY;

-- Retenção de 7 dias via pg_cron
SELECT cron.schedule('purge_webhook_events_raw', '15 3 * * *',
  $$DELETE FROM public.webhook_events_raw WHERE created_at < now() - interval '7 days'$$);

-- PARTE 4: broadcast também quando a mídia ficar pronta
CREATE OR REPLACE FUNCTION public.notify_wa_message_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime'
AS $function$
BEGIN
  IF COALESCE(NEW.is_mass_dispatch, false) = true THEN RETURN NEW; END IF;
  IF (NEW.status IS NOT DISTINCT FROM OLD.status)
     AND (NEW.media_url IS NOT DISTINCT FROM OLD.media_url) THEN
    RETURN NEW;
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'phone', NEW.phone,
      'whatsapp_number_id', NEW.whatsapp_number_id,
      'message_id', NEW.message_id,
      'status', NEW.status
    ),
    'wa_msg_update',
    'wa_msg_inserts',
    false
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_wa_message_update ON public.whatsapp_messages;
CREATE TRIGGER trg_notify_wa_message_update
  AFTER UPDATE OF status, media_url ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_wa_message_update();