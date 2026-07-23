ALTER TABLE public.event_leads
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS disqualified BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_event_leads_custom_fields
  ON public.event_leads USING GIN (custom_fields);