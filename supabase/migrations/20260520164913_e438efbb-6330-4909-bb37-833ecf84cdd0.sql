
ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_cpf text,
  ADD COLUMN IF NOT EXISTS customer_city text,
  ADD COLUMN IF NOT EXISTS customer_state text,
  ADD COLUMN IF NOT EXISTS customer_cep text;
