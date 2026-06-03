ALTER TABLE public.inventory_count_items
  ADD COLUMN IF NOT EXISTS last_corrected_quantity integer;

COMMENT ON COLUMN public.inventory_count_items.last_corrected_quantity IS 'Última quantidade já aplicada como correção de balanço (modo Total Inteligente). Evita reprocessar itens inalterados.';