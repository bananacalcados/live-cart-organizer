
-- 1. email_lists (referenced by contacts and campaigns)
CREATE TABLE public.email_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  contact_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
);
ALTER TABLE public.email_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own email_lists" ON public.email_lists FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2. email_templates
CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text,
  blocks jsonb DEFAULT '[]'::jsonb,
  html_content text,
  thumbnail_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
);
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own email_templates" ON public.email_templates FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3. email_contacts
CREATE TABLE public.email_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text,
  tags text[] DEFAULT '{}',
  custom_fields jsonb DEFAULT '{}'::jsonb,
  subscribed boolean NOT NULL DEFAULT true,
  unsubscribed_at timestamptz,
  list_id uuid REFERENCES public.email_lists(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, list_id)
);
ALTER TABLE public.email_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage contacts via list ownership" ON public.email_contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.email_lists WHERE id = email_contacts.list_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.email_lists WHERE id = email_contacts.list_id AND user_id = auth.uid()));

-- 4. email_campaigns
CREATE TABLE public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  from_name text,
  from_email text,
  template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  list_id uuid REFERENCES public.email_lists(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  total_recipients int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
);
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own email_campaigns" ON public.email_campaigns FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 5. email_events
CREATE TABLE public.email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.email_campaigns(id) ON DELETE CASCADE NOT NULL,
  contact_id uuid REFERENCES public.email_contacts(id) ON DELETE CASCADE NOT NULL,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view events via campaign ownership" ON public.email_events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.email_campaigns WHERE id = email_events.campaign_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.email_campaigns WHERE id = email_events.campaign_id AND user_id = auth.uid()));

-- Indexes for email_events
CREATE INDEX idx_email_events_campaign_id ON public.email_events (campaign_id);
CREATE INDEX idx_email_events_contact_id ON public.email_events (contact_id);
CREATE INDEX idx_email_events_event_type ON public.email_events (event_type);

-- Updated_at triggers
CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_email_campaigns_updated_at BEFORE UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
