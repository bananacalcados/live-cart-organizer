
-- Backfill do Módulo Estoque (products_master/product_variants) a partir do PDV (pos_products)
-- Padrão PAI > FILHO. Idempotente. Modo dry-run por padrão (não grava nada).
CREATE OR REPLACE FUNCTION public.backfill_estoque_from_pos(p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parents_to_create int := 0;
  v_variants_to_create int := 0;
  v_parents_created int := 0;
  v_variants_created int := 0;
  v_sample jsonb;
BEGIN
  -- Base de candidatos: produtos reais do PDV, excluindo lixo de teste
  CREATE TEMP TABLE _base ON COMMIT DROP AS
  SELECT *,
         trim(regexp_replace(name, '\s*-\s*.*$', '')) AS base_name,
         COALESCE(NULLIF(barcode,''), sku) AS vkey
  FROM pos_products
  WHERE parent_sku IS NOT NULL AND parent_sku <> ''
    AND sku IS NOT NULL AND sku <> ''
    AND parent_sku NOT IN ('TESTE-005')
    AND parent_sku NOT LIKE 'POS-%'
    AND lower(coalesce(name,'')) NOT LIKE '%produto teste%';

  -- Variações realmente ausentes no Módulo Estoque (nem por GTIN, nem por SKU)
  CREATE TEMP TABLE _missing ON COMMIT DROP AS
  SELECT b.* FROM _base b
  WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.gtin = NULLIF(b.barcode,''))
    AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.sku = b.sku)
    AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.gtin = b.sku);

  -- Dedup: 1 linha por variação (vkey), somando estoque entre lojas
  CREATE TEMP TABLE _variants ON COMMIT DROP AS
  SELECT DISTINCT ON (vkey)
    vkey, parent_sku, base_name, name, size, color,
    NULLIF(barcode,'') AS gtin, sku, cost_price, price,
    (SELECT COALESCE(sum(m2.stock),0) FROM _missing m2 WHERE m2.vkey = m.vkey) AS total_stock
  FROM _missing m
  ORDER BY vkey, stock DESC NULLS LAST;

  -- Pais necessários (parent_sku ainda sem products_master)
  CREATE TEMP TABLE _parents ON COMMIT DROP AS
  SELECT DISTINCT ON (parent_sku)
    parent_sku,
    base_name,
    category, brand, gender, age_group, cost_price, price
  FROM _variants v
  WHERE NOT EXISTS (SELECT 1 FROM products_master m WHERE m.sku_root = v.parent_sku)
  ORDER BY parent_sku, base_name;
  -- enriquecer pais a partir do pos_products original (category/brand podem estar em outra linha)
  UPDATE _parents p SET
    category = COALESCE(p.category, (SELECT max(category) FROM pos_products x WHERE x.parent_sku = p.parent_sku)),
    brand    = COALESCE(p.brand,    (SELECT max(brand)    FROM pos_products x WHERE x.parent_sku = p.parent_sku)),
    gender   = COALESCE(p.gender,   (SELECT max(gender)   FROM pos_products x WHERE x.parent_sku = p.parent_sku));

  SELECT count(*) INTO v_parents_to_create FROM _parents;
  SELECT count(*) INTO v_variants_to_create FROM _variants;

  SELECT jsonb_agg(t) INTO v_sample FROM (
    SELECT parent_sku, base_name, size, color, gtin, sku, total_stock
    FROM _variants ORDER BY parent_sku, size LIMIT 30
  ) t;

  IF p_commit THEN
    -- 1) Criar PAIS
    INSERT INTO products_master (sku_root, name, category, brand, gender, age_group,
                                 cost_price, sale_price, is_active, needs_review, review_reason)
    SELECT parent_sku, base_name, category, brand, gender, age_group,
           NULLIF(cost_price,0), NULLIF(price,0), true, true, 'Criado por backfill do PDV'
    FROM _parents
    ON CONFLICT (sku_root) DO NOTHING;
    GET DIAGNOSTICS v_parents_created = ROW_COUNT;

    -- 2) Criar FILHOS (variações), ligados ao pai por sku_root
    INSERT INTO product_variants (master_id, sku, gtin, color, size,
                                  cost_price_override, sale_price_override,
                                  initial_stock, is_active, last_sync_source)
    SELECT m.id, v.sku, v.gtin, v.color, v.size,
           NULLIF(v.cost_price,0), NULLIF(v.price,0),
           v.total_stock, true, 'pos_backfill'
    FROM _variants v
    JOIN products_master m ON m.sku_root = v.parent_sku
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_variants_created = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', NOT p_commit,
    'pais_a_criar', v_parents_to_create,
    'variacoes_a_criar', v_variants_to_create,
    'pais_criados', v_parents_created,
    'variacoes_criadas', v_variants_created,
    'amostra', COALESCE(v_sample, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_estoque_from_pos(boolean) TO authenticated, service_role;
