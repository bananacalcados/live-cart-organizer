-- Tabela de mapeamento Shopify Variant → Yampi SKU
CREATE TABLE public.shopify_yampi_mapping (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_variant_id text NOT NULL UNIQUE,
  shopify_sku text,
  yampi_sku_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Índices para busca rápida
CREATE INDEX idx_shopify_yampi_mapping_variant ON public.shopify_yampi_mapping(shopify_variant_id);
CREATE INDEX idx_shopify_yampi_mapping_sku ON public.shopify_yampi_mapping(shopify_sku);

-- Enable RLS
ALTER TABLE public.shopify_yampi_mapping ENABLE ROW LEVEL SECURITY;

-- Política de acesso (acesso total para o app)
CREATE POLICY "Allow all access to shopify_yampi_mapping"
ON public.shopify_yampi_mapping
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger para updated_at
CREATE TRIGGER update_shopify_yampi_mapping_updated_at
BEFORE UPDATE ON public.shopify_yampi_mapping
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Comentários
COMMENT ON TABLE public.shopify_yampi_mapping IS 'Mapeia variantes da Shopify para SKU IDs da Yampi';
COMMENT ON COLUMN public.shopify_yampi_mapping.shopify_variant_id IS 'GID completo da variante Shopify (ex: gid://shopify/ProductVariant/123)';
COMMENT ON COLUMN public.shopify_yampi_mapping.shopify_sku IS 'Código SKU da Shopify (para referência)';
COMMENT ON COLUMN public.shopify_yampi_mapping.yampi_sku_id IS 'ID numérico do SKU na Yampi';