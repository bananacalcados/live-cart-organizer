ALTER TABLE public.event_leads DROP CONSTRAINT IF EXISTS event_leads_source_check;
ALTER TABLE public.event_leads ADD CONSTRAINT event_leads_source_check
  CHECK (source = ANY (ARRAY['lp'::text, 'typebot'::text, 'referral'::text, 'manual'::text, 'member_area'::text, 'live'::text]));