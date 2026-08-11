ALTER TABLE public.lp_leads ADD COLUMN IF NOT EXISTS event_id text;
CREATE INDEX IF NOT EXISTS idx_lp_leads_event_id ON public.lp_leads(event_id);