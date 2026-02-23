
CREATE TABLE public.pos_payment_methods (
  id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id)
);

ALTER TABLE public.pos_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pos_payment_methods" ON public.pos_payment_methods FOR ALL USING (true) WITH CHECK (true);
