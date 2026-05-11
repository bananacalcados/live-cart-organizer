
-- ============ event_landing_pages ============
CREATE TABLE public.event_landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Cadastre-se',
  published BOOLEAN NOT NULL DEFAULT false,
  hero_image_url TEXT,
  og_image_url TEXT,
  theme_json JSONB NOT NULL DEFAULT '{"primary":"#facc15","background":"#0f172a","font":"Inter"}'::jsonb,
  config_json JSONB NOT NULL DEFAULT '{"blocks":[]}'::jsonb,
  vip_group_link TEXT,
  success_message TEXT DEFAULT 'Cadastro confirmado! Entre no grupo VIP.',
  prize_description TEXT DEFAULT 'Indique 3 amigos e ganhe um prêmio especial!',
  event_starts_at TIMESTAMPTZ,
  require_privacy_consent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_landing_pages_event ON public.event_landing_pages(event_id);
CREATE INDEX idx_event_landing_pages_slug ON public.event_landing_pages(slug);

ALTER TABLE public.event_landing_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth manage event_landing_pages" ON public.event_landing_pages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public read published landing pages" ON public.event_landing_pages
  FOR SELECT TO anon USING (published = true);

CREATE TRIGGER update_event_landing_pages_updated_at
  BEFORE UPDATE ON public.event_landing_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============ event_typebots ============
CREATE TABLE public.event_typebots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Typebot',
  published BOOLEAN NOT NULL DEFAULT false,
  theme_json JSONB NOT NULL DEFAULT '{"primary":"#facc15","background":"#0f172a"}'::jsonb,
  flow_json JSONB NOT NULL DEFAULT '{"steps":[]}'::jsonb,
  welcome_message TEXT DEFAULT 'Olá! Vou te cadastrar no nosso evento.',
  success_message TEXT DEFAULT 'Pronto! Você está cadastrado.',
  vip_group_link TEXT,
  event_starts_at TIMESTAMPTZ,
  prize_description TEXT DEFAULT 'Indique 3 amigos e ganhe um prêmio!',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_typebots_event ON public.event_typebots(event_id);
CREATE INDEX idx_event_typebots_slug ON public.event_typebots(slug);

ALTER TABLE public.event_typebots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth manage event_typebots" ON public.event_typebots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public read published typebots" ON public.event_typebots
  FOR SELECT TO anon USING (published = true);

CREATE TRIGGER update_event_typebots_updated_at
  BEFORE UPDATE ON public.event_typebots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============ event_leads ============
CREATE TABLE public.event_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_suffix TEXT GENERATED ALWAYS AS (RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 8)) STORED,
  source TEXT NOT NULL DEFAULT 'lp' CHECK (source IN ('lp','typebot','referral','manual')),
  landing_page_id UUID REFERENCES public.event_landing_pages(id) ON DELETE SET NULL,
  typebot_id UUID REFERENCES public.event_typebots(id) ON DELETE SET NULL,
  referral_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  referred_by_lead_id UUID REFERENCES public.event_leads(id) ON DELETE SET NULL,
  referred_count INTEGER NOT NULL DEFAULT 0,
  prize_unlocked_at TIMESTAMPTZ,
  vip_group_sent_at TIMESTAMPTZ,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, phone)
);

CREATE INDEX idx_event_leads_event ON public.event_leads(event_id);
CREATE INDEX idx_event_leads_referral_token ON public.event_leads(referral_token);
CREATE INDEX idx_event_leads_referred_by ON public.event_leads(referred_by_lead_id);
CREATE INDEX idx_event_leads_phone_suffix ON public.event_leads(phone_suffix);

ALTER TABLE public.event_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth manage event_leads" ON public.event_leads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_event_leads_updated_at
  BEFORE UPDATE ON public.event_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============ Trigger: marco de 3 indicações ============
CREATE OR REPLACE FUNCTION public.increment_referral_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INTEGER;
  v_indicador_id UUID;
BEGIN
  IF NEW.referred_by_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_indicador_id := NEW.referred_by_lead_id;

  UPDATE public.event_leads
    SET referred_count = referred_count + 1,
        prize_unlocked_at = CASE
          WHEN prize_unlocked_at IS NULL AND referred_count + 1 >= 3 THEN now()
          ELSE prize_unlocked_at
        END
    WHERE id = v_indicador_id
    RETURNING referred_count INTO v_new_count;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_event_leads_referral_count
  AFTER INSERT ON public.event_leads
  FOR EACH ROW EXECUTE FUNCTION public.increment_referral_count();


-- ============ Storage bucket ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-landing-assets', 'event-landing-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read event-landing-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-landing-assets');

CREATE POLICY "Auth upload event-landing-assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-landing-assets');

CREATE POLICY "Auth update event-landing-assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'event-landing-assets');

CREATE POLICY "Auth delete event-landing-assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'event-landing-assets');
