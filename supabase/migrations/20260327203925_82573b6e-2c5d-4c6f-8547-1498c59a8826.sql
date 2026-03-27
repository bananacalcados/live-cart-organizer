CREATE TABLE public.ai_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  agent text NOT NULL DEFAULT 'concierge',
  phone text,
  error_type text NOT NULL,
  error_message text,
  provider_attempted text,
  fallback_provider text,
  fallback_success boolean DEFAULT false,
  customer_message text,
  ai_response text,
  history_sent_count integer,
  context_payload jsonb,
  status text NOT NULL DEFAULT 'open',
  resolution_notes text,
  resolved_by text,
  resolved_at timestamptz
);

CREATE INDEX idx_ai_error_logs_agent ON public.ai_error_logs(agent);
CREATE INDEX idx_ai_error_logs_created ON public.ai_error_logs(created_at DESC);
CREATE INDEX idx_ai_error_logs_status ON public.ai_error_logs(status);

ALTER TABLE public.ai_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ai_error_logs"
  ON public.ai_error_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert ai_error_logs"
  ON public.ai_error_logs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update ai_error_logs"
  ON public.ai_error_logs FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Service role full access ai_error_logs"
  ON public.ai_error_logs FOR ALL TO service_role USING (true);