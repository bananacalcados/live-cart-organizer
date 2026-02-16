
CREATE TABLE public.automation_dispatch_sent (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_dispatch_sent_flow_phone ON public.automation_dispatch_sent(flow_id, phone);
CREATE INDEX idx_dispatch_sent_flow ON public.automation_dispatch_sent(flow_id);

ALTER TABLE public.automation_dispatch_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view dispatch sent" ON public.automation_dispatch_sent FOR SELECT USING (true);
CREATE POLICY "Service role manages dispatch sent" ON public.automation_dispatch_sent FOR ALL USING (true);
