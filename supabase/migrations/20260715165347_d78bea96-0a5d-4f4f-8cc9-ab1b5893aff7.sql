ALTER TABLE public.customers_unified DROP CONSTRAINT IF EXISTS customers_unified_classificacao_disparo_check;
ALTER TABLE public.customers_unified
  ADD CONSTRAINT customers_unified_classificacao_disparo_check
  CHECK (classificacao_disparo IS NULL OR classificacao_disparo IN (
    'quente','morno','frio','silencio','silencio_reativavel','silencio_puro'
  ));