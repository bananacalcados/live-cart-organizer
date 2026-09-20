
CREATE OR REPLACE FUNCTION public.pc_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT upper(translate(coalesce(t,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
$$;

CREATE OR REPLACE FUNCTION public.pc_slug(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(regexp_replace(lower(public.pc_norm(t)), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.pc_gender_from_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN public.pc_norm(t) LIKE '%MENINA%' THEN 'Menina'
    WHEN public.pc_norm(t) LIKE '%MENINO%' THEN 'Menino'
    WHEN public.pc_norm(t) LIKE '%INFANTIL%' AND public.pc_norm(t) LIKE '%FEM%' THEN 'Menina'
    WHEN public.pc_norm(t) LIKE '%INFANTIL%' AND public.pc_norm(t) LIKE '%MASC%' THEN 'Menino'
    WHEN public.pc_norm(t) LIKE '%FEMININ%' THEN 'Feminino'
    WHEN public.pc_norm(t) LIKE '%MASCULIN%' THEN 'Masculino'
    WHEN public.pc_norm(t) LIKE '%UNISSEX%' THEN 'Unissex'
    WHEN public.pc_norm(t) LIKE '%INFANTIL%' THEN 'Infantil'
    WHEN public.pc_norm(t) LIKE '%BEBE%' THEN 'Infantil'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.pc_gender_canon(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE public.pc_norm(btrim(coalesce(t,'')))
    WHEN 'FEMININO' THEN 'Feminino'
    WHEN 'MASCULINO' THEN 'Masculino'
    WHEN 'UNISSEX' THEN 'Unissex'
    WHEN 'MENINO' THEN 'Menino'
    WHEN 'MENINA' THEN 'Menina'
    WHEN 'INFANTIL' THEN 'Infantil'
    ELSE NULL
  END;
$$;

CREATE TABLE IF NOT EXISTS public.product_category_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_name text NOT NULL,
  new_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_category_merge_log TO authenticated;
GRANT ALL ON public.product_category_merge_log TO service_role;
ALTER TABLE public.product_category_merge_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_category_merge_log') THEN
    CREATE POLICY "Authenticated can read category merge log"
      ON public.product_category_merge_log FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

ALTER TABLE public.pos_products
  ADD COLUMN IF NOT EXISTS brand_source text,
  ADD COLUMN IF NOT EXISTS category_source text,
  ADD COLUMN IF NOT EXISTS gender_source text;
ALTER TABLE public.products_master
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS brand_source text,
  ADD COLUMN IF NOT EXISTS category_source text,
  ADD COLUMN IF NOT EXISTS gender_source text;

ALTER TABLE public.pos_products DROP CONSTRAINT IF EXISTS pos_products_gender_check;
ALTER TABLE public.products_master DROP CONSTRAINT IF EXISTS products_master_gender_check;
ALTER TABLE public.product_categories DROP CONSTRAINT IF EXISTS product_categories_default_gender_check;

UPDATE public.product_categories SET default_gender = public.pc_gender_canon(default_gender)
WHERE default_gender IS NOT NULL AND default_gender IS DISTINCT FROM public.pc_gender_canon(default_gender);
UPDATE public.pos_products SET gender = public.pc_gender_canon(gender)
WHERE gender IS NOT NULL AND gender IS DISTINCT FROM public.pc_gender_canon(gender);
UPDATE public.products_master SET gender = public.pc_gender_canon(gender)
WHERE gender IS NOT NULL AND gender IS DISTINCT FROM public.pc_gender_canon(gender);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_products_gender_chk') THEN
    ALTER TABLE public.pos_products ADD CONSTRAINT pos_products_gender_chk
      CHECK (gender IS NULL OR gender IN ('Feminino','Masculino','Unissex','Menino','Menina','Infantil'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_master_gender_chk') THEN
    ALTER TABLE public.products_master ADD CONSTRAINT products_master_gender_chk
      CHECK (gender IS NULL OR gender IN ('Feminino','Masculino','Unissex','Menino','Menina','Infantil'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_categories_default_gender_chk') THEN
    ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_default_gender_chk
      CHECK (default_gender IS NULL OR default_gender IN ('Feminino','Masculino','Unissex','Menino','Menina','Infantil'));
  END IF;
END $$;

UPDATE public.pos_products SET brand = NULL WHERE brand IS NOT NULL AND btrim(brand) = '';
UPDATE public.pos_products SET category = NULL WHERE category IS NOT NULL AND btrim(category) = '';
UPDATE public.products_master SET brand = NULL WHERE brand IS NOT NULL AND btrim(brand) = '';
UPDATE public.products_master SET category = NULL WHERE category IS NOT NULL AND btrim(category) = '';

UPDATE public.pos_products SET brand_source='legacy' WHERE brand IS NOT NULL AND brand_source IS NULL;
UPDATE public.pos_products SET category_source='legacy' WHERE category IS NOT NULL AND category_source IS NULL;
UPDATE public.pos_products SET gender_source='legacy' WHERE gender IS NOT NULL AND gender_source IS NULL;
UPDATE public.products_master SET brand_source='legacy' WHERE brand IS NOT NULL AND brand_source IS NULL;
UPDATE public.products_master SET category_source='legacy' WHERE category IS NOT NULL AND category_source IS NULL;
UPDATE public.products_master SET gender_source='legacy' WHERE gender IS NOT NULL AND gender_source IS NULL;

UPDATE public.pos_products p
SET gender = g.v, gender_source = 'rule_name'
FROM (SELECT id, public.pc_gender_from_text(coalesce(name,'') || ' ' || coalesce(category,'')) v FROM public.pos_products WHERE gender IS NULL) g
WHERE g.id = p.id AND g.v IS NOT NULL;

UPDATE public.products_master p
SET gender = g.v, gender_source = 'rule_name'
FROM (SELECT id, public.pc_gender_from_text(coalesce(name,'') || ' ' || coalesce(category,'')) v FROM public.products_master WHERE gender IS NULL) g
WHERE g.id = p.id AND g.v IS NOT NULL;

INSERT INTO public.product_brands (name, slug, is_active)
SELECT v.n, public.pc_slug(v.n), true
FROM (VALUES ('Modare'),('Mississipi'),('Moleca'),('Molekinha'),('Vizzano'),('Beira Rio'),('Pegada'),
             ('Piccadilly'),('Jota Pê'),('Cartago'),('Grendha'),('Dakota'),('Usaflex'),('Rider'),
             ('Hugo Boss'),('Adidas'),('Nike'),('On Cloud'),('B Confort'),('Guarujá'),('New Balance'),
             ('Havaianas')) v(n)
WHERE NOT EXISTS (SELECT 1 FROM public.product_brands b WHERE lower(b.name) = lower(v.n))
  AND NOT EXISTS (SELECT 1 FROM public.product_brands b WHERE b.slug = public.pc_slug(v.n));

CREATE TEMP TABLE _brand_map(old_name text, new_name text) ON COMMIT DROP;
INSERT INTO _brand_map VALUES
 ('Banana Calçados','B Confort'),('Banana Calcados','B Confort'),('BANANA','B Confort'),
 ('BCONFORT','B Confort'),('B CONFORT','B Confort'),('GRENDHA','Grendha'),
 ('Jotapê','Jota Pê'),('JOTA PE','Jota Pê'),('GUARUJÁ','Guarujá'),('modare','Modare'),
 ('On','On Cloud'),('NB','New Balance');

UPDATE public.pos_products p SET brand = m.new_name
FROM _brand_map m WHERE lower(p.brand) = lower(m.old_name) AND p.brand <> m.new_name;

UPDATE public.products_master p SET brand = m.new_name
FROM _brand_map m WHERE lower(p.brand) = lower(m.old_name) AND p.brand <> m.new_name;

DELETE FROM public.product_brands b
USING _brand_map m
WHERE lower(b.name) = lower(m.old_name) AND lower(b.name) <> lower(m.new_name);

CREATE TEMP TABLE _cat_map(old_name text, new_name text) ON COMMIT DROP;
INSERT INTO _cat_map VALUES
 ('Babuches','Babuche'),('Bolsas','Bolsa'),('Botas','Bota'),('Carteiras','Carteira'),
 ('Chinelos','Chinelo'),('Chuteiras','Chuteira'),('Mocassim F','Mocassim'),
 ('Mocassim Masculino','Mocassim'),('Papetes','Papete'),('Rasteirinhas','Rasteirinha'),
 ('Saltos','Salto'),('Sandalia','Sandália'),('Sandalias','Sandália'),
 ('Sandalia Baixa','Sandália Baixa'),('Sandálias Baixas','Sandália Baixa'),
 ('Sapatênis Masculino','Sapatênis'),('Sapatenis Masculino','Sapatênis'),
 ('Sapatilhas','Sapatilha'),('Sapato Social Masculino','Sapato Social'),
 ('Tamancos','Tamanco'),('Tenis Casual','Tênis Casual'),('Tênis Casual Masculino','Tênis Casual'),
 ('Tenis Masculino','Tênis'),('Tenis','Tênis'),('Sapatos','Sapato'),('Mules','Mule'),
 ('Masculino',NULL),('Infantil',NULL);

INSERT INTO public.product_categories (name, slug, is_active, priority)
SELECT v.n, public.pc_slug(v.n), true, 0
FROM (VALUES ('Anabela'),('Babuche'),('Bolsa'),('Bota'),('Carteira'),('Chinelo'),('Chuteira'),
             ('Coturno'),('Meia'),('Mocassim'),('Mule'),('Papete'),('Plataforma'),('Rasteirinha'),
             ('Salto'),('Sandália'),('Sandália Baixa'),('Sapatilha'),('Sapatênis'),('Sapato'),
             ('Sapato Social'),('Scarpin'),('Slide'),('Tamanco'),('Tênis'),('Tênis Casual'),
             ('Tênis Esportivo')) v(n)
WHERE NOT EXISTS (SELECT 1 FROM public.product_categories c WHERE lower(c.name) = lower(v.n))
  AND NOT EXISTS (SELECT 1 FROM public.product_categories c WHERE c.slug = public.pc_slug(v.n));

UPDATE public.pos_products p
SET category = m.new_name,
    category_source = CASE WHEN m.new_name IS NULL THEN NULL ELSE p.category_source END
FROM _cat_map m
WHERE lower(p.category) = lower(m.old_name) AND p.category IS DISTINCT FROM m.new_name;

UPDATE public.products_master p
SET category = m.new_name,
    category_source = CASE WHEN m.new_name IS NULL THEN NULL ELSE p.category_source END
FROM _cat_map m
WHERE lower(p.category) = lower(m.old_name) AND p.category IS DISTINCT FROM m.new_name;

UPDATE public.pos_products p
SET category_id = c.id
FROM public.product_categories c
WHERE lower(c.name) = lower(p.category) AND p.category IS NOT NULL AND p.category_id IS DISTINCT FROM c.id;
UPDATE public.pos_products p SET category_id = NULL WHERE p.category IS NULL AND p.category_id IS NOT NULL;

DELETE FROM public.product_categories c
USING _cat_map m
WHERE lower(c.name) = lower(m.old_name)
  AND (m.new_name IS NULL OR lower(c.name) <> lower(m.new_name));

INSERT INTO public.product_category_merge_log (old_name, new_name)
SELECT old_name, new_name FROM _cat_map;
