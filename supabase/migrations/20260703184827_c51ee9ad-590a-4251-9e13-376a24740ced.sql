-- Tabela de rastreio/trava das Trocas do Site (converter pedido do site em venda da vendedora)
CREATE TABLE public.pos_site_exchanges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id TEXT NOT NULL,
  shopify_order_name TEXT,
  original_pos_sale_id UUID,
  new_pos_sale_id UUID,
  seller_id UUID,
  store_id UUID,
  exchange_reason TEXT,
  original_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  zeroed_barcodes TEXT[] NOT NULL DEFAULT '{}',
  step_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'reserved',
  error_message TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Uma troca por pedido do site (impede duas vendedoras converterem o mesmo pedido)
CREATE UNIQUE INDEX pos_site_exchanges_shopify_order_id_key
  ON public.pos_site_exchanges (shopify_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_site_exchanges TO authenticated;
GRANT ALL ON public.pos_site_exchanges TO service_role;

ALTER TABLE public.pos_site_exchanges ENABLE ROW LEVEL SECURITY;

-- Equipe autenticada pode ver e gerenciar as trocas do site
CREATE POLICY "Authenticated can view site exchanges"
  ON public.pos_site_exchanges FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create site exchanges"
  ON public.pos_site_exchanges FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update site exchanges"
  ON public.pos_site_exchanges FOR UPDATE TO authenticated USING (true);

-- trigger updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_pos_site_exchanges_updated_at
  BEFORE UPDATE ON public.pos_site_exchanges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();