ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method_label text,
  ADD COLUMN IF NOT EXISTS installments integer;

COMMENT ON COLUMN public.orders.payment_method_label IS 'Forma de pagamento capturada do gateway no checkout (ex: PIX, Cartão de Crédito 3x)';
COMMENT ON COLUMN public.orders.installments IS 'Número de parcelas quando pago via cartão de crédito';