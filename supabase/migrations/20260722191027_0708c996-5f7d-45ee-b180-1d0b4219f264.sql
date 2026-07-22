
-- 1) Tabela de redirecionadores
CREATE TABLE public.live_redirect_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  click_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_redirect_links_slug_format CHECK (slug ~ '^[a-z0-9-]+$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_redirect_links TO authenticated;
GRANT ALL ON public.live_redirect_links TO service_role;

ALTER TABLE public.live_redirect_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage live redirect links"
  ON public.live_redirect_links FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2) Tabela de cliques
CREATE TABLE public.live_redirect_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  redirect_id uuid NOT NULL REFERENCES public.live_redirect_links(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  phone text,
  utm_source text,
  user_agent text,
  target_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_redirect_clicks_redirect_created
  ON public.live_redirect_clicks (redirect_id, created_at DESC);
CREATE INDEX idx_live_redirect_clicks_event
  ON public.live_redirect_clicks (event_id);

GRANT SELECT ON public.live_redirect_clicks TO authenticated;
GRANT ALL ON public.live_redirect_clicks TO service_role;

ALTER TABLE public.live_redirect_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view live redirect clicks"
  ON public.live_redirect_clicks FOR SELECT
  TO authenticated
  USING (true);

-- 3) Trigger updated_at pro links
CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_live_redirect_links_updated_at
  BEFORE UPDATE ON public.live_redirect_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- 4) Campos novos em events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS instagram_live_url text,
  ADD COLUMN IF NOT EXISTS is_live_broadcasting boolean NOT NULL DEFAULT false;

-- 5) Trigger: só 1 evento pode estar broadcasting
CREATE OR REPLACE FUNCTION public.enforce_single_live_broadcasting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_live_broadcasting = true THEN
    UPDATE public.events
      SET is_live_broadcasting = false
      WHERE id <> NEW.id AND is_live_broadcasting = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_live_broadcasting ON public.events;
CREATE TRIGGER trg_enforce_single_live_broadcasting
  AFTER INSERT OR UPDATE OF is_live_broadcasting ON public.events
  FOR EACH ROW
  WHEN (NEW.is_live_broadcasting = true)
  EXECUTE FUNCTION public.enforce_single_live_broadcasting();
