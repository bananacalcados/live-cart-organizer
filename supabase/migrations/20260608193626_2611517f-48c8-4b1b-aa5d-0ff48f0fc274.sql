CREATE TABLE public.webhook_routing_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  sender_phone TEXT,
  resolution_method TEXT NOT NULL DEFAULT 'none',
  resolved_whatsapp_number_id UUID,
  raw_identifier TEXT,
  matched BOOLEAN NOT NULL DEFAULT false,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.webhook_routing_log TO authenticated;
GRANT ALL ON public.webhook_routing_log TO service_role;

ALTER TABLE public.webhook_routing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read routing log"
  ON public.webhook_routing_log FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_webhook_routing_log_created_at ON public.webhook_routing_log (created_at DESC);
CREATE INDEX idx_webhook_routing_log_matched ON public.webhook_routing_log (matched, created_at DESC);
CREATE INDEX idx_webhook_routing_log_provider ON public.webhook_routing_log (provider, created_at DESC);

-- Daily cleanup of rows older than 14 days
CREATE OR REPLACE FUNCTION public.cleanup_webhook_routing_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.webhook_routing_log WHERE created_at < now() - interval '14 days';
$$;

SELECT cron.schedule(
  'cleanup-webhook-routing-log',
  '0 4 * * *',
  $$ SELECT public.cleanup_webhook_routing_log(); $$
);