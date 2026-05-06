-- Add event_date to landing pages so each LP can have its own countdown target
ALTER TABLE public.campaign_landing_pages
  ADD COLUMN IF NOT EXISTS event_date timestamptz;

-- Create the new campaign "LIVE 09/05"
INSERT INTO public.marketing_campaigns (id, name, status, channels, start_date)
VALUES (gen_random_uuid(), 'LIVE 09/05', 'active', ARRAY['landing_page'], '2026-05-09')
RETURNING id;