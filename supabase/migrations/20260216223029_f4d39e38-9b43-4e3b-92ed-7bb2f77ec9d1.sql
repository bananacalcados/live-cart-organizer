
-- Table to track pending automation flow continuations waiting for button replies
CREATE TABLE public.automation_pending_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  flow_id UUID NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  pending_step_index INTEGER NOT NULL,
  step_id UUID REFERENCES public.automation_steps(id) ON DELETE CASCADE,
  button_branches JSONB DEFAULT '{}',
  whatsapp_number_id TEXT,
  recipient_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '24 hours'),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Index for quick lookups
CREATE INDEX idx_pending_replies_phone_active ON public.automation_pending_replies(phone, is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.automation_pending_replies ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated full access pending_replies" ON public.automation_pending_replies
FOR ALL USING (auth.role() = 'authenticated');
