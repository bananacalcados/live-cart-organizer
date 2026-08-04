DROP INDEX IF EXISTS public.uq_pos_sales_source_order_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sales_source_order_active
  ON public.pos_sales (source_order_id)
  WHERE source_order_id IS NOT NULL
    AND status <> 'cancelled'
    AND created_at >= TIMESTAMPTZ '2026-07-28 00:00:00+00';