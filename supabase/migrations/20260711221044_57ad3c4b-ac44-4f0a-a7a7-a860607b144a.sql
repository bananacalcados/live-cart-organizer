-- Unificação de pedidos do mesmo cliente no mesmo evento.
-- Um pedido "filho" aponta para o pedido "mestre" via merged_into_order_id.
-- Reversível: basta limpar merged_into_order_id.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS merged_into_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_by uuid;

CREATE INDEX IF NOT EXISTS idx_orders_merged_into ON public.orders(merged_into_order_id);