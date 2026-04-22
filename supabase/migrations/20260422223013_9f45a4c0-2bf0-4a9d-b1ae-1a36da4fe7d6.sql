-- Tabela isolada para clientes da loja Ravena
CREATE TABLE public.ravena_customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  region TEXT,
  store TEXT,
  seller TEXT,
  ddd TEXT,
  rfm_segment TEXT,
  rfm_r INTEGER,
  rfm_f INTEGER,
  rfm_m INTEGER,
  rfm_total INTEGER,
  total_orders INTEGER DEFAULT 0,
  total_spent NUMERIC(12,2) DEFAULT 0,
  avg_ticket NUMERIC(12,2) DEFAULT 0,
  last_purchase_at DATE,
  first_purchase_at DATE,
  city TEXT,
  state TEXT,
  tags TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ravena_customers_phone ON public.ravena_customers(phone);
CREATE INDEX idx_ravena_customers_segment ON public.ravena_customers(rfm_segment);
CREATE INDEX idx_ravena_customers_state ON public.ravena_customers(state);
CREATE INDEX idx_ravena_customers_city ON public.ravena_customers(city);
CREATE INDEX idx_ravena_customers_tags ON public.ravena_customers USING GIN(tags);

ALTER TABLE public.ravena_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ravena_customers"
ON public.ravena_customers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_ravena_customers_updated_at
BEFORE UPDATE ON public.ravena_customers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();