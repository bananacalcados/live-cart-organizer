
-- Tabela de regras de precificação por modalidade de compra
CREATE TABLE public.pos_product_pricing_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  pickup_discount_percent NUMERIC NOT NULL DEFAULT 10,
  physical_store_price_source TEXT NOT NULL DEFAULT 'website',
  physical_store_markup_percent NUMERIC NOT NULL DEFAULT 0,
  delivery_fee NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Apenas uma regra por loja
CREATE UNIQUE INDEX idx_pos_pricing_rules_store ON public.pos_product_pricing_rules(store_id);

-- RLS
ALTER TABLE public.pos_product_pricing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pricing rules" ON public.pos_product_pricing_rules
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger de updated_at
CREATE TRIGGER update_pos_product_pricing_rules_updated_at
  BEFORE UPDATE ON public.pos_product_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
