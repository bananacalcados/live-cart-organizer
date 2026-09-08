ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_sedex boolean NOT NULL DEFAULT false;
ALTER TABLE public.expedition_orders ADD COLUMN IF NOT EXISTS priority_sedex boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_is_sedex ON public.orders (is_sedex) WHERE is_sedex;
CREATE INDEX IF NOT EXISTS idx_expedition_orders_priority_sedex ON public.expedition_orders (priority_sedex) WHERE priority_sedex;