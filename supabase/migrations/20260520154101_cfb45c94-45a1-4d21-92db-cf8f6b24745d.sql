-- Add event_id to pos_sales to track which sales came from a Live/Event
ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_event_id ON public.pos_sales(event_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_store_event ON public.pos_sales(store_id, event_id) WHERE event_id IS NOT NULL;

-- Backfill from orders.event_id via source_order_id (where source_order_id is a uuid pointing to orders)
UPDATE public.pos_sales ps
SET event_id = o.event_id
FROM public.orders o
WHERE ps.event_id IS NULL
  AND ps.source_order_id IS NOT NULL
  AND ps.source_order_id = o.id
  AND o.event_id IS NOT NULL;