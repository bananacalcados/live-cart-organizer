-- Idempotency locks for live Shopify order creation
CREATE TABLE IF NOT EXISTS public.shopify_live_order_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  session_id UUID NULL,
  source TEXT NOT NULL DEFAULT 'live',
  customer_phone_normalized TEXT NULL,
  customer_email_normalized TEXT NULL,
  customer_cpf_normalized TEXT NULL,
  line_signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shopify_order_id TEXT NULL,
  shopify_order_name TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_live_order_locks_session_id
  ON public.shopify_live_order_locks(session_id);
CREATE INDEX IF NOT EXISTS idx_shopify_live_order_locks_status
  ON public.shopify_live_order_locks(status);
CREATE INDEX IF NOT EXISTS idx_shopify_live_order_locks_locked_at
  ON public.shopify_live_order_locks(locked_at DESC);

ALTER TABLE public.shopify_live_order_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view Shopify live order locks"
ON public.shopify_live_order_locks
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Audit/sync registry for live Shopify orders and duplicate review actions
CREATE TABLE IF NOT EXISTS public.shopify_live_order_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL,
  session_id UUID NULL,
  source TEXT NOT NULL DEFAULT 'live',
  order_id UUID NULL,
  live_viewer_id UUID NULL,
  customer_name TEXT NULL,
  customer_phone_normalized TEXT NULL,
  customer_email_normalized TEXT NULL,
  customer_cpf_normalized TEXT NULL,
  line_signature TEXT NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  shopify_order_id TEXT NULL,
  shopify_order_name TEXT NULL,
  shopify_order_created_at TIMESTAMPTZ NULL,
  sync_status TEXT NOT NULL DEFAULT 'created',
  is_duplicate_candidate BOOLEAN NOT NULL DEFAULT false,
  duplicate_group_key TEXT NULL,
  duplicate_reason TEXT NULL,
  duplicate_rank INTEGER NULL,
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by UUID NULL,
  review_status TEXT NULL,
  resolution_action TEXT NULL,
  resolution_notes TEXT NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_live_order_syncs_dedupe_key
  ON public.shopify_live_order_syncs(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_shopify_live_order_syncs_session_id
  ON public.shopify_live_order_syncs(session_id);
CREATE INDEX IF NOT EXISTS idx_shopify_live_order_syncs_duplicate_group
  ON public.shopify_live_order_syncs(duplicate_group_key)
  WHERE duplicate_group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shopify_live_order_syncs_customer_phone
  ON public.shopify_live_order_syncs(customer_phone_normalized);
CREATE INDEX IF NOT EXISTS idx_shopify_live_order_syncs_shopify_order_id
  ON public.shopify_live_order_syncs(shopify_order_id)
  WHERE shopify_order_id IS NOT NULL;

ALTER TABLE public.shopify_live_order_syncs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view Shopify live order syncs"
ON public.shopify_live_order_syncs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update Shopify live order syncs"
ON public.shopify_live_order_syncs
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Updated-at triggers
DROP TRIGGER IF EXISTS update_shopify_live_order_locks_updated_at ON public.shopify_live_order_locks;
CREATE TRIGGER update_shopify_live_order_locks_updated_at
BEFORE UPDATE ON public.shopify_live_order_locks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_shopify_live_order_syncs_updated_at ON public.shopify_live_order_syncs;
CREATE TRIGGER update_shopify_live_order_syncs_updated_at
BEFORE UPDATE ON public.shopify_live_order_syncs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();