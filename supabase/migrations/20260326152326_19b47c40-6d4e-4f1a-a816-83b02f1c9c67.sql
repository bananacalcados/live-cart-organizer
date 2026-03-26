
CREATE TABLE public.livete_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id),
  stage_atendimento TEXT,
  reminder_level INTEGER NOT NULL DEFAULT 0,
  max_levels INTEGER NOT NULL DEFAULT 4,
  next_reminder_at TIMESTAMPTZ,
  last_client_message_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  completed_at TIMESTAMPTZ,
  whatsapp_number_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_livete_followups_active ON public.livete_followups (is_active, next_reminder_at) WHERE is_active = true;
CREATE INDEX idx_livete_followups_phone ON public.livete_followups (phone);

ALTER TABLE public.livete_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON public.livete_followups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
