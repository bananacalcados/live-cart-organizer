
CREATE TABLE IF NOT EXISTS public.meta_capi_purchase_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  event_name TEXT NOT NULL DEFAULT 'Purchase',
  event_id TEXT NOT NULL,
  pixel_id TEXT,
  test_event_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','error','skipped')),
  http_status INTEGER,
  meta_response JSONB,
  error_message TEXT,
  payload_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_capi_purchase_log_unique_order_event
  ON public.meta_capi_purchase_log (order_id, event_name);
CREATE INDEX IF NOT EXISTS idx_meta_capi_purchase_log_created_at
  ON public.meta_capi_purchase_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_capi_purchase_log_status
  ON public.meta_capi_purchase_log (status);
CREATE INDEX IF NOT EXISTS idx_meta_capi_purchase_log_order_id
  ON public.meta_capi_purchase_log (order_id);

ALTER TABLE public.meta_capi_purchase_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view meta capi purchase logs"
  ON public.meta_capi_purchase_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
