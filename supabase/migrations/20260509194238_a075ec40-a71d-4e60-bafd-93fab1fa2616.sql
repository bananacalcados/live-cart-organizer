CREATE TABLE IF NOT EXISTS public.order_shopify_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  previous_shopify_order_id text,
  previous_shopify_order_name text,
  new_shopify_order_id text,
  new_shopify_order_name text,
  action text NOT NULL DEFAULT 'exchange',
  reason text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_shopify_history_order_id ON public.order_shopify_history(order_id);

ALTER TABLE public.order_shopify_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/managers can view shopify history"
  ON public.order_shopify_history FOR SELECT
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Admins/managers can insert shopify history"
  ON public.order_shopify_history FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));