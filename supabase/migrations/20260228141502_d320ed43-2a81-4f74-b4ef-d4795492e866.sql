
-- Follow-up automático: rastreia lembretes de pagamento
CREATE TABLE public.chat_payment_followups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  sale_id TEXT,
  type TEXT NOT NULL DEFAULT 'checkout',
  reminder_count INTEGER NOT NULL DEFAULT 0,
  max_reminders INTEGER NOT NULL DEFAULT 3,
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  next_reminder_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  seller_id TEXT,
  whatsapp_number_id UUID
);

CREATE INDEX idx_payment_followups_active ON public.chat_payment_followups (is_active, next_reminder_at) WHERE is_active = true;
CREATE INDEX idx_payment_followups_phone ON public.chat_payment_followups (phone);

-- NPS: pesquisas de satisfação
CREATE TABLE public.chat_nps_surveys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  seller_id TEXT,
  store_id UUID,
  score INTEGER,
  feedback TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  finish_conversation_id UUID,
  whatsapp_number_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nps_surveys_phone ON public.chat_nps_surveys (phone);
CREATE INDEX idx_nps_surveys_seller ON public.chat_nps_surveys (seller_id);
CREATE INDEX idx_nps_surveys_responded ON public.chat_nps_surveys (responded_at) WHERE responded_at IS NULL;

-- Enable realtime for followups (para atualizar timer no frontend)
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_payment_followups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_nps_surveys;
