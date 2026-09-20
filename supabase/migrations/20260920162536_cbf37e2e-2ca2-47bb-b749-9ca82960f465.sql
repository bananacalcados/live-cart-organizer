
CREATE OR REPLACE FUNCTION public.pc_ref_prefix(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN btrim(coalesce(t,'')) ~ '^[0-9]{4}\.' THEN substring(btrim(t) from 1 for 4)
    WHEN split_part(btrim(coalesce(t,'')),' ',1) ~ '[0-9]'
         AND length(split_part(btrim(coalesce(t,'')),' ',1)) >= 4
      THEN upper(split_part(btrim(t),' ',1))
    ELSE NULL
  END;
$$;

-- limpa categoria invalida "S"
UPDATE public.pos_products SET category = NULL, category_id = NULL, category_source = NULL
WHERE btrim(coalesce(category,'')) = 'S';

-- ===== CAMADA 1: MARCA POR NOME =====
WITH aliases AS (
  SELECT public.pc_norm(name) AS token, name AS brand FROM public.product_brands
  UNION ALL
  SELECT * FROM (VALUES ('BCONFORT','B Confort'),('B CONFORT','B Confort'),('BANANA','B Confort'),
                        ('JOTA PE','Jota Pê'),('JOTAPE','Jota Pê'),('NEW BALANCE','New Balance')) v(token,brand)
), cand AS (
  SELECT p.id, a.brand,
         row_number() OVER (PARTITION BY p.id ORDER BY length(a.token) DESC) rn
  FROM public.pos_products p
  JOIN aliases a ON public.pc_norm(p.name) ~ ('(^|[^A-Z0-9])' || a.token || '($|[^A-Z0-9])')
  WHERE p.brand IS NULL AND length(a.token) >= 3
)
UPDATE public.pos_products p
SET brand = c.brand, brand_source = 'rule_name'
FROM cand c WHERE c.id = p.id AND c.rn = 1 AND p.brand IS NULL;

-- ===== CAMADA 1: CATEGORIA POR PALAVRA-CHAVE =====
WITH kw(k, cat, prio) AS (VALUES
  ('SAPATENIS','Sapatênis',1),('RASTEIR','Rasteirinha',1),('SCARPIN','Scarpin',1),
  ('COTURNO','Coturno',1),('CHUTEIRA','Chuteira',1),('SAPATILHA','Sapatilha',1),
  ('MOCASSIM','Mocassim',1),('BABUCHE','Babuche',1),('ANABELA','Anabela',1),
  ('PAPETE','Papete',1),('TAMANCO','Tamanco',1),('CHINELO','Chinelo',1),
  ('BOTA','Bota',1),('MULE','Mule',1),('BOLSA','Bolsa',1),('CINTO','Cinto',1),
  ('MEIA','Meia',1),('CARTEIRA','Carteira',1),('PALMILHA','Palmilha',1),
  ('SALTO','Salto',2),('TENIS','Tênis',3),('SANDALIA','Sandália',4),('SAPATO','Sapato',5)
), cand AS (
  SELECT p.id, k.cat,
         row_number() OVER (PARTITION BY p.id ORDER BY k.prio, length(k.k) DESC) rn
  FROM public.pos_products p
  JOIN kw k ON public.pc_norm(p.name) LIKE '%' || k.k || '%'
  WHERE p.category IS NULL
)
UPDATE public.pos_products p
SET category = c.cat, category_source = 'rule_name'
FROM cand c WHERE c.id = p.id AND c.rn = 1 AND p.category IS NULL;

-- ===== CAMADA 2: MARCA POR PREFIXO DE REFERENCIA =====
WITH base AS (
  SELECT public.pc_ref_prefix(name) pfx, brand FROM public.pos_products
  WHERE brand IS NOT NULL AND public.pc_ref_prefix(name) IS NOT NULL
), agg AS (SELECT pfx, brand, count(*) c FROM base GROUP BY 1,2),
tot AS (SELECT pfx, sum(c) t FROM agg GROUP BY 1),
win AS (SELECT a.pfx, a.brand FROM agg a JOIN tot ON tot.pfx = a.pfx
        WHERE tot.t >= 10 AND a.c::numeric / tot.t >= 0.9)
UPDATE public.pos_products p
SET brand = w.brand, brand_source = 'rule_ref'
FROM win w
WHERE p.brand IS NULL AND public.pc_ref_prefix(p.name) = w.pfx;

-- ===== CAMADA 2: CATEGORIA POR PREFIXO DE REFERENCIA =====
WITH base AS (
  SELECT public.pc_ref_prefix(name) pfx, category FROM public.pos_products
  WHERE category IS NOT NULL AND public.pc_ref_prefix(name) IS NOT NULL
), agg AS (SELECT pfx, category, count(*) c FROM base GROUP BY 1,2),
tot AS (SELECT pfx, sum(c) t FROM agg GROUP BY 1),
win AS (SELECT a.pfx, a.category FROM agg a JOIN tot ON tot.pfx = a.pfx
        WHERE tot.t >= 10 AND a.c::numeric / tot.t >= 0.9)
UPDATE public.pos_products p
SET category = w.category, category_source = 'rule_ref'
FROM win w
WHERE p.category IS NULL AND public.pc_ref_prefix(p.name) = w.pfx;

-- garante no vocabulario as categorias/marcas geradas pelas regras
INSERT INTO public.product_categories (name, slug, is_active, priority)
SELECT DISTINCT p.category, public.pc_slug(p.category), true, 0
FROM public.pos_products p
WHERE p.category IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.product_categories c WHERE lower(c.name) = lower(p.category))
  AND NOT EXISTS (SELECT 1 FROM public.product_categories c WHERE c.slug = public.pc_slug(p.category));

UPDATE public.pos_products p
SET category_id = c.id
FROM public.product_categories c
WHERE lower(c.name) = lower(p.category) AND p.category IS NOT NULL AND p.category_id IS DISTINCT FROM c.id;

-- genero para os que ainda estao vazios (nome pode ter mudado de categoria agora)
UPDATE public.pos_products p
SET gender = g.v, gender_source = 'rule_name'
FROM (SELECT id, public.pc_gender_from_text(coalesce(name,'') || ' ' || coalesce(category,'')) v
      FROM public.pos_products WHERE gender IS NULL) g
WHERE g.id = p.id AND g.v IS NOT NULL;
