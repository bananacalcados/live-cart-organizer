CREATE TABLE IF NOT EXISTS public.meta_capi_lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK (event_name IN ('Lead', 'CompleteRegistration')),
  event_id TEXT NOT NULL UNIQUE,
  campaign_id UUID,
  campaign_slug TEXT,
  pixel_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','error')),
  meta_response JSONB,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_lead_events_phone ON public.meta_capi_lead_events(phone);
CREATE INDEX IF NOT EXISTS idx_meta_capi_lead_events_phone_event ON public.meta_capi_lead_events(phone, event_name);

ALTER TABLE public.meta_capi_lead_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view capi lead events"
ON public.meta_capi_lead_events FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));