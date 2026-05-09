
CREATE TABLE IF NOT EXISTS public.pos_cash_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cash_register_id uuid NOT NULL REFERENCES public.pos_cash_registers(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  seller_id uuid,
  type text NOT NULL CHECK (type IN ('withdraw','deposit')),
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_register ON public.pos_cash_movements(cash_register_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_store ON public.pos_cash_movements(store_id);

ALTER TABLE public.pos_cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view cash movements"
ON public.pos_cash_movements FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert cash movements"
ON public.pos_cash_movements FOR INSERT
TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete cash movements"
ON public.pos_cash_movements FOR DELETE
TO authenticated USING (true);
