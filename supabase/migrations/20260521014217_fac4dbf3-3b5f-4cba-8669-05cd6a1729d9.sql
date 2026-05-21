
-- 1) Remove whatsapp_messages from realtime publication (stops WAL decoding for it)
ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_messages;

-- 2) Trigger function: broadcast INSERT only, on topic 'wa_msg_inserts'
CREATE OR REPLACE FUNCTION public.notify_wa_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'phone', NEW.phone,
      'whatsapp_number_id', NEW.whatsapp_number_id,
      'direction', NEW.direction,
      'created_at', NEW.created_at
    ),
    'wa_msg_insert',     -- event name
    'wa_msg_inserts',    -- topic / channel
    false                -- private = false (public broadcast)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block inserts if broadcast fails
  RETURN NEW;
END;
$$;

-- 3) Trigger
DROP TRIGGER IF EXISTS trg_notify_wa_message_insert ON public.whatsapp_messages;
CREATE TRIGGER trg_notify_wa_message_insert
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_wa_message_insert();
