
CREATE TABLE IF NOT EXISTS public.product_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_brands_name_unique UNIQUE (name),
  CONSTRAINT product_brands_slug_unique UNIQUE (slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_brands TO authenticated;
GRANT ALL ON public.product_brands TO service_role;

ALTER TABLE public.product_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read brands" ON public.product_brands;
DROP POLICY IF EXISTS "authenticated manage brands" ON public.product_brands;
CREATE POLICY "authenticated read brands" ON public.product_brands
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated manage brands" ON public.product_brands
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tg_product_brands_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_product_brands_updated_at ON public.product_brands;
CREATE TRIGGER trg_product_brands_updated_at BEFORE UPDATE ON public.product_brands
  FOR EACH ROW EXECUTE FUNCTION public.tg_product_brands_updated_at();

-- Seed dedup por slug: pega o primeiro nome de cada slug distinto
INSERT INTO public.product_brands (name, slug)
SELECT DISTINCT ON (slug) name, slug FROM (
  SELECT
    trim(brand) AS name,
    lower(regexp_replace(trim(brand), '[^a-zA-Z0-9]+', '-', 'g')) AS slug
  FROM public.product_master_data
  WHERE brand IS NOT NULL AND trim(brand) <> ''
) s
WHERE slug <> ''
ORDER BY slug, name
ON CONFLICT DO NOTHING;
