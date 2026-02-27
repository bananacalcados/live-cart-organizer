
CREATE TABLE public.dispatch_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name TEXT NOT NULL,
  template_language TEXT DEFAULT 'pt_BR',
  whatsapp_number_id UUID,
  audience_source TEXT DEFAULT 'crm',
  audience_filters JSONB DEFAULT '{}',
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  rendered_message TEXT,
  variables_config JSONB DEFAULT '{}',
  force_resend BOOLEAN DEFAULT false,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'sending',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view dispatch history"
ON public.dispatch_history FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert dispatch history"
ON public.dispatch_history FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update dispatch history"
ON public.dispatch_history FOR UPDATE
TO authenticated
USING (true);

-- Track which phones were part of each dispatch
CREATE TABLE public.dispatch_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dispatch_id UUID NOT NULL REFERENCES public.dispatch_history(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  recipient_name TEXT,
  status TEXT DEFAULT 'pending',
  message_wamid TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view dispatch recipients"
ON public.dispatch_recipients FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert dispatch recipients"
ON public.dispatch_recipients FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update dispatch recipients"
ON public.dispatch_recipients FOR UPDATE
TO authenticated
USING (true);

CREATE INDEX idx_dispatch_recipients_dispatch_id ON public.dispatch_recipients(dispatch_id);
CREATE INDEX idx_dispatch_recipients_phone ON public.dispatch_recipients(phone);
CREATE INDEX idx_dispatch_history_started_at ON public.dispatch_history(started_at DESC);
