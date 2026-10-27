CREATE OR REPLACE FUNCTION public.notify_live_intent_dismissal_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime'
AS $function$
DECLARE
  row_event_id uuid;
  row_username text;
  row_dismissed_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_event_id := OLD.event_id;
    row_username := OLD.username;
    row_dismissed_at := OLD.dismissed_at;
  ELSE
    row_event_id := NEW.event_id;
    row_username := NEW.username;
    row_dismissed_at := NEW.dismissed_at;
  END IF;
  IF row_event_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'event_id', row_event_id,
      'username', row_username,
      'dismissed_at', row_dismissed_at,
      'op', TG_OP
    ),
    'live_intent_dismissal',
    'live_clicks_' || row_event_id::text,
    false
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_live_intent_dismissal_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_live_intent_dismissal ON public.live_order_intent_dismissals;
CREATE TRIGGER trg_notify_live_intent_dismissal
AFTER INSERT OR UPDATE OF dismissed_at OR DELETE
ON public.live_order_intent_dismissals
FOR EACH ROW EXECUTE FUNCTION public.notify_live_intent_dismissal_change();