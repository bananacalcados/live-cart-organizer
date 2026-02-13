
-- Table to track active AI conversation sessions
CREATE TABLE public.automation_ai_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  prompt TEXT,
  whatsapp_number_id TEXT,
  flow_id UUID REFERENCES public.automation_flows(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  max_messages INTEGER DEFAULT 50,
  messages_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Index for quick lookup by phone
CREATE INDEX idx_ai_sessions_phone_active ON public.automation_ai_sessions (phone, is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.automation_ai_sessions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role full access" ON public.automation_ai_sessions FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_ai_sessions;
