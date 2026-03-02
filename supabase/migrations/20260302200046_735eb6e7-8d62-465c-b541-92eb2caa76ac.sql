
-- New table: scheduled messages within a campaign
CREATE TABLE public.group_campaign_scheduled_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.group_campaigns(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_content TEXT,
  media_url TEXT,
  poll_options JSONB,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  send_speed TEXT NOT NULL DEFAULT 'normal',
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_campaign_scheduled_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage scheduled messages" ON public.group_campaign_scheduled_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- New table: redirect links
CREATE TABLE public.group_redirect_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.group_campaigns(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  is_deep_link BOOLEAN NOT NULL DEFAULT false,
  click_count INTEGER NOT NULL DEFAULT 0,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_redirect_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage redirect links" ON public.group_redirect_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public can read active redirect links" ON public.group_redirect_links FOR SELECT TO anon USING (is_active = true);

-- Alter whatsapp_groups
ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS max_participants INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS is_full BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invite_link TEXT,
  ADD COLUMN IF NOT EXISTS only_admins_send BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS only_admins_add BOOLEAN NOT NULL DEFAULT false;

-- Alter group_campaigns
ALTER TABLE public.group_campaigns
  ADD COLUMN IF NOT EXISTS send_speed TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS campaign_link_slug TEXT,
  ADD COLUMN IF NOT EXISTS is_deep_link BOOLEAN NOT NULL DEFAULT false;
