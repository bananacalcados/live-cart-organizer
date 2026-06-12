-- 1. Status normalization (single source of truth for uazapi raw statuses)
CREATE OR REPLACE FUNCTION public.normalize_wa_status(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(raw,''))
    WHEN 'pending'      THEN 'pending'
    WHEN 'sending'      THEN 'pending'
    WHEN 'sent'         THEN 'sent'
    WHEN 'serverack'    THEN 'sent'
    WHEN 'server_ack'   THEN 'sent'
    WHEN 'deliveryack'  THEN 'delivered'
    WHEN 'delivery_ack' THEN 'delivered'
    WHEN 'delivered'    THEN 'delivered'
    WHEN 'read'         THEN 'read'
    WHEN 'viewed'       THEN 'read'
    WHEN 'played'       THEN 'played'
    WHEN 'error'        THEN 'failed'
    WHEN 'failed'       THEN 'failed'
    ELSE NULL
  END;
$$;

-- 2. Status ordering (statuses can only move forward; out-of-order webhooks are common)
CREATE OR REPLACE FUNCTION public.wa_status_rank(s text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'pending'   THEN 0
    WHEN 'sent'      THEN 1
    WHEN 'failed'    THEN 2
    WHEN 'delivered' THEN 3
    WHEN 'read'      THEN 4
    WHEN 'played'    THEN 5
    ELSE -1
  END;
$$;

-- 3. Guard trigger: normalizes incoming status values and prevents regressions (read can never go back to delivered)
CREATE OR REPLACE FUNCTION public.wa_message_status_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  norm text;
  old_norm text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    norm := public.normalize_wa_status(NEW.status);
    old_norm := public.normalize_wa_status(OLD.status);
    IF norm IS NULL THEN
      NEW.status := OLD.status;  -- unknown value: ignore, keep current
    ELSIF old_norm IS NOT NULL
      AND public.wa_status_rank(norm) <= public.wa_status_rank(old_norm) THEN
      NEW.status := OLD.status;  -- never move backwards
    ELSE
      NEW.status := norm;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wa_message_status_guard ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_message_status_guard
BEFORE UPDATE OF status ON public.whatsapp_messages
FOR EACH ROW
WHEN (NEW.direction = 'outgoing')
EXECUTE FUNCTION public.wa_message_status_guard();

-- 4. Realtime broadcast on status change (mirrors the existing notify_wa_message_insert pattern)
CREATE OR REPLACE FUNCTION public.notify_wa_message_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','realtime'
AS $$
BEGIN
  IF COALESCE(NEW.is_mass_dispatch, false) = true THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
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
END $$;

DROP TRIGGER IF EXISTS trg_notify_wa_message_update ON public.whatsapp_messages;
CREATE TRIGGER trg_notify_wa_message_update
AFTER UPDATE OF status ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_wa_message_update();

-- 5. One-time cleanup of historical rows stuck with raw uazapi statuses
UPDATE public.whatsapp_messages
SET status = public.normalize_wa_status(status)
WHERE direction = 'outgoing'
  AND public.normalize_wa_status(status) IS NOT NULL
  AND status <> public.normalize_wa_status(status);