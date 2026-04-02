CREATE TABLE public.chat_scheduled_followups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  situation_hint TEXT DEFAULT NULL,
  campaign_id UUID REFERENCES public.ad_campaigns_ai(id) ON DELETE SET NULL,
  whatsapp_number_id UUID DEFAULT NULL,
  is_sent BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_scheduled_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage scheduled followups"
ON public.chat_scheduled_followups
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE INDEX idx_scheduled_followups_pending 
ON public.chat_scheduled_followups (scheduled_at) 
WHERE is_sent = false;