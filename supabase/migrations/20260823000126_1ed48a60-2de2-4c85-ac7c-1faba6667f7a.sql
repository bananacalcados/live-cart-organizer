ALTER TABLE public.event_leads
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS link_tag text,
  ADD COLUMN IF NOT EXISTS link_slug text;

CREATE INDEX IF NOT EXISTS idx_event_leads_link_slug ON public.event_leads (link_slug);
CREATE INDEX IF NOT EXISTS idx_event_leads_utm_campaign ON public.event_leads (utm_campaign);