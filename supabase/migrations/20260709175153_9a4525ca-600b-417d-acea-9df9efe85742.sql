CREATE TABLE IF NOT EXISTS public.zoppy_first_purchase_import (
  suffix text PRIMARY KEY,
  first_dt date NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zoppy_first_purchase_import TO authenticated;
GRANT ALL ON public.zoppy_first_purchase_import TO service_role;
ALTER TABLE public.zoppy_first_purchase_import ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages first purchase import" ON public.zoppy_first_purchase_import FOR ALL TO service_role USING (true) WITH CHECK (true);