CREATE TABLE IF NOT EXISTS public.group_redirect_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.group_redirect_links(id) ON DELETE CASCADE,
  campaign_id uuid,
  slug text NOT NULL,
  kind text NOT NULL DEFAULT 'click',
  group_db_id uuid,
  user_agent text,
  utm_source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_redirect_clicks_link_created ON public.group_redirect_clicks(link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_redirect_clicks_campaign_created ON public.group_redirect_clicks(campaign_id, created_at DESC);
GRANT SELECT ON public.group_redirect_clicks TO authenticated;
GRANT ALL ON public.group_redirect_clicks TO service_role;
ALTER TABLE public.group_redirect_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read group redirect clicks" ON public.group_redirect_clicks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages group redirect clicks" ON public.group_redirect_clicks FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.whatsapp_group_snapshots TO service_role;
DROP POLICY IF EXISTS "Service role manages group snapshots" ON public.whatsapp_group_snapshots;
CREATE POLICY "Service role manages group snapshots" ON public.whatsapp_group_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.record_whatsapp_group_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_rec timestamptz;
  last_count integer;
BEGIN
  IF NEW.participant_count IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT recorded_at, participant_count INTO last_rec, last_count
  FROM public.whatsapp_group_snapshots
  WHERE group_id = NEW.id
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF last_rec IS NOT NULL
     AND last_count = NEW.participant_count
     AND last_rec > now() - interval '1 hour' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.whatsapp_group_snapshots (group_id, participant_count)
  VALUES (NEW.id, NEW.participant_count);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_whatsapp_group_snapshot ON public.whatsapp_groups;
CREATE TRIGGER trg_record_whatsapp_group_snapshot
AFTER INSERT OR UPDATE OF participant_count ON public.whatsapp_groups
FOR EACH ROW EXECUTE FUNCTION public.record_whatsapp_group_snapshot();

INSERT INTO public.whatsapp_group_snapshots (group_id, participant_count)
SELECT id, COALESCE(participant_count, 0) FROM public.whatsapp_groups;