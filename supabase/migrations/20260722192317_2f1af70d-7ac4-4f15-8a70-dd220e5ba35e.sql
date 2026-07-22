
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS live_broadcast_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_url_updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.trg_events_live_url_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.instagram_live_url IS DISTINCT FROM OLD.instagram_live_url
     AND NEW.instagram_live_url IS NOT NULL
     AND length(trim(NEW.instagram_live_url)) > 0 THEN
    NEW.live_url_updated_at := now();
  END IF;
  IF NEW.is_live_broadcasting = true
     AND (OLD.is_live_broadcasting IS DISTINCT FROM true) THEN
    NEW.live_broadcast_started_at := now();
    IF NEW.instagram_live_url IS NOT NULL AND NEW.live_url_updated_at IS NULL THEN
      NEW.live_url_updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_live_url_touch ON public.events;
CREATE TRIGGER events_live_url_touch
BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.trg_events_live_url_touch();
