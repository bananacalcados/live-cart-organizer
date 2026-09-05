CREATE OR REPLACE FUNCTION public.notify_live_click_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime'
AS $function$
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'event_id', NEW.event_id,
      'entered_phone', NEW.entered_phone,
      'phone', NEW.phone,
      'op', TG_OP,
      'created_at', NEW.created_at
    ),
    'live_click',
    'live_clicks_' || NEW.event_id::text,
    false
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_live_click_change ON public.live_whatsapp_clicks;
CREATE TRIGGER trg_notify_live_click_change
AFTER INSERT OR UPDATE OF entered_phone, phone, real_phone, superseded, matched_at, lead_id
ON public.live_whatsapp_clicks
FOR EACH ROW EXECUTE FUNCTION public.notify_live_click_change();