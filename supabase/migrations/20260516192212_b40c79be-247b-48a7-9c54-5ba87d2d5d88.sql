
-- 1. Categories table
CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  keywords text[] NOT NULL DEFAULT '{}',
  default_gender text CHECK (default_gender IN ('masculino','feminino','unissex','infantil')),
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Price tiers table
CREATE TABLE public.price_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  min_price numeric(12,2) NOT NULL DEFAULT 0,
  max_price numeric(12,2),
  color text NOT NULL DEFAULT '#94a3b8',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. New columns on pos_products
ALTER TABLE public.pos_products
  ADD COLUMN category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN gender text CHECK (gender IN ('masculino','feminino','unissex','infantil')),
  ADD COLUMN age_group text CHECK (age_group IN ('adulto','infantil')),
  ADD COLUMN price_tier_id uuid REFERENCES public.price_tiers(id) ON DELETE SET NULL,
  ADD COLUMN auto_classified boolean NOT NULL DEFAULT false,
  ADD COLUMN classification_confidence numeric(3,2);

CREATE INDEX idx_pos_products_category_id ON public.pos_products(category_id);
CREATE INDEX idx_pos_products_gender ON public.pos_products(gender);
CREATE INDEX idx_pos_products_price_tier ON public.pos_products(price_tier_id);

-- 4. Same on products_master
ALTER TABLE public.products_master
  ADD COLUMN category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN gender text CHECK (gender IN ('masculino','feminino','unissex','infantil')),
  ADD COLUMN age_group text CHECK (age_group IN ('adulto','infantil')),
  ADD COLUMN price_tier_id uuid REFERENCES public.price_tiers(id) ON DELETE SET NULL,
  ADD COLUMN auto_classified boolean NOT NULL DEFAULT false,
  ADD COLUMN classification_confidence numeric(3,2);

-- 5. Seed categories
INSERT INTO public.product_categories (name, slug, keywords, default_gender, priority) VALUES
  ('Chuteiras',                'chuteiras',               ARRAY['CHUTEIRA','CHUTEIRAS','SOCIETY'],                'masculino', 10),
  ('Papetes',                  'papetes',                 ARRAY['BIRKEN','PAPETE','PAPETES'],                      NULL,         20),
  ('Babuches',                 'babuches',                ARRAY['BABUCHE','BABUCHES'],                             NULL,         30),
  ('Mocassim',                 'mocassim',                ARRAY['MOCASSIM','MOCASSINS','MOCASSI'],                 NULL,         40),
  ('Sapatilhas',               'sapatilhas',              ARRAY['SAPATILHA','SAPATILHAS'],                         'feminino',  50),
  ('Rasteirinhas',             'rasteirinhas',            ARRAY['RASTEIRINHA','RASTEIRA','RASTEIRAS'],             'feminino',  60),
  ('Chinelos',                 'chinelos',                ARRAY['CHINELO','CHINELOS'],                             NULL,         70),
  ('Tamancos',                 'tamancos',                ARRAY['TAMANCO','TAMANCOS','ANABELA'],                   'feminino',  80),
  ('Botas',                    'botas',                   ARRAY['BOTA','BOTAS','BOTINHA','BOTINHAS','COTURNO'],    NULL,         90),
  ('Saltos',                   'saltos',                  ARRAY['SALTO','SALTOS','SCARPIN','SCARPINS','PEEP TOE'], 'feminino', 100),
  ('Sapato Social Masculino',  'sapato-social-masculino', ARRAY['SAPATO SOCIAL','SOCIAL MASC','SOCIAL MASCULINO'], 'masculino',110),
  ('Sandálias Baixas',         'sandalias-baixas',        ARRAY['SANDALIA','SANDÁLIA','SANDALIAS','SANDÁLIAS'],    'feminino', 120),
  ('Tênis Esportivo',          'tenis-esportivo',         ARRAY['TENIS ESPORTIVO','TÊNIS ESPORTIVO','RUNNING','CORRIDA','TRAINING','CAMINHADA'], NULL, 130),
  ('Tênis Casual',             'tenis-casual',            ARRAY['TENIS','TÊNIS','SNEAKER'],                        NULL,        140),
  ('Bolsas',                   'bolsas',                  ARRAY['BOLSA','BOLSAS','BOLSINHA','MOCHILA','CARTEIRA'], 'feminino', 150);

-- 6. Seed price tiers
INSERT INTO public.price_tiers (label, min_price, max_price, color, sort_order) VALUES
  ('Até R$ 100',       0,    100,   '#22c55e', 1),
  ('R$ 100 a R$ 160',  100.01, 160, '#3b82f6', 2),
  ('R$ 161 a R$ 200',  160.01, 200, '#8b5cf6', 3),
  ('R$ 201 a R$ 300',  200.01, 300, '#f59e0b', 4),
  ('R$ 300+',          300.01, NULL,'#ef4444', 5);

-- 7. Trigger to auto-assign price_tier on insert/update
CREATE OR REPLACE FUNCTION public.assign_price_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  SELECT id INTO NEW.price_tier_id
  FROM public.price_tiers
  WHERE NEW.price >= min_price
    AND (max_price IS NULL OR NEW.price <= max_price)
  ORDER BY sort_order ASC
  LIMIT 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pos_products_price_tier
  BEFORE INSERT OR UPDATE OF price ON public.pos_products
  FOR EACH ROW EXECUTE FUNCTION public.assign_price_tier();

CREATE TRIGGER trg_products_master_price_tier
  BEFORE INSERT OR UPDATE OF sale_price ON public.products_master
  FOR EACH ROW EXECUTE FUNCTION public.assign_price_tier();

-- For products_master the price column is sale_price; adapt trigger:
CREATE OR REPLACE FUNCTION public.assign_price_tier_master()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  SELECT id INTO NEW.price_tier_id
  FROM public.price_tiers
  WHERE NEW.sale_price >= min_price
    AND (max_price IS NULL OR NEW.sale_price <= max_price)
  ORDER BY sort_order ASC
  LIMIT 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER trg_products_master_price_tier ON public.products_master;
CREATE TRIGGER trg_products_master_price_tier
  BEFORE INSERT OR UPDATE OF sale_price ON public.products_master
  FOR EACH ROW EXECUTE FUNCTION public.assign_price_tier_master();

-- 8. Backfill price_tier_id for existing rows
UPDATE public.pos_products p
SET price_tier_id = (
  SELECT id FROM public.price_tiers
  WHERE p.price >= min_price AND (max_price IS NULL OR p.price <= max_price)
  ORDER BY sort_order LIMIT 1
);

UPDATE public.products_master p
SET price_tier_id = (
  SELECT id FROM public.price_tiers
  WHERE p.sale_price >= min_price AND (max_price IS NULL OR p.sale_price <= max_price)
  ORDER BY sort_order LIMIT 1
);

-- 9. RLS
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_read_auth" ON public.product_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_write_auth" ON public.product_categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "price_tiers_read_auth" ON public.price_tiers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "price_tiers_write_auth" ON public.price_tiers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 10. updated_at triggers
CREATE TRIGGER update_product_categories_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_price_tiers_updated_at
  BEFORE UPDATE ON public.price_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
