ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gateway_amount numeric, ADD COLUMN IF NOT EXISTS gateway_snapshot jsonb;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS gateway_amount numeric, ADD COLUMN IF NOT EXISTS gateway_snapshot jsonb;
COMMENT ON COLUMN public.orders.gateway_snapshot IS 'Snapshot do pedido no momento em que a cobrança foi gerada (valor calculado no servidor).';