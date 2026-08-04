-- Etapa 1: trava física contra duplicação de vendas de expedição vindas do mesmo pedido.
-- O índice é parcial e só vale para vendas criadas a partir do corte abaixo,
-- para não conflitar com as duplicatas históricas (que serão tratadas na limpeza).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sales_source_order_active
  ON public.pos_sales (source_order_id)
  WHERE source_order_id IS NOT NULL
    AND status <> 'cancelled'
    AND created_at >= TIMESTAMPTZ '2026-08-04 18:00:00+00';