CREATE OR REPLACE FUNCTION public.event_unarchive_on_incoming_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suffix text;
BEGIN
  v_suffix := right(regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g'), 8);
  IF v_suffix IS NULL OR length(v_suffix) < 8 THEN
    RETURN NEW;
  END IF;

  -- Remove o arquivamento apenas de eventos ainda ativos (sem end_date ou end_date futuro).
  DELETE FROM public.event_archived_conversations a
  USING public.events e
  WHERE a.event_id = e.id
    AND right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 8) = v_suffix
    AND a.created_at < coalesce(NEW.created_at, now())
    AND (e.end_date IS NULL OR e.end_date >= now() - interval '1 day');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_unarchive_on_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_event_unarchive_on_incoming
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE)
EXECUTE FUNCTION public.event_unarchive_on_incoming_message();

CREATE INDEX IF NOT EXISTS idx_event_archived_conversations_phone_suffix
  ON public.event_archived_conversations ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8)));

ALTER TABLE public.event_archived_conversations REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'event_archived_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_archived_conversations;
  END IF;
END $$;