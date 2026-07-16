
-- 1) Listagem agrupada por pai
CREATE OR REPLACE FUNCTION public.list_pos_estoque_divergences_grouped(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  parent_sku text,
  parent_name text,
  has_master boolean,
  total_divergent_variants bigint,
  total_divergent_stock numeric,
  variants jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH divergent AS (
    SELECT pp.id, pp.parent_sku, pp.name, pp.sku, pp.barcode, pp.size, pp.color,
           pp.store_id, pp.stock, pp.price, pp.cost_price
    FROM pos_products pp
    WHERE pp.parent_sku IS NOT NULL AND pp.parent_sku <> ''
      AND pp.parent_sku NOT LIKE 'POS-%' AND pp.parent_sku <> 'TESTE-005'
      AND lower(coalesce(pp.name,'')) NOT LIKE '%produto teste%'
      AND pp.name !~ '[–—]'
      AND NOT EXISTS (
        SELECT 1 FROM product_variants v
        WHERE (coalesce(pp.barcode,'') <> '' AND v.gtin = pp.barcode) OR v.sku = pp.sku
      )
  ),
  -- Para cada divergente, tenta achar irmão "correto" no PDV (mesmo parent+color+size, mas cujo barcode bate com product_variants)
  correct_sibling AS (
    SELECT d.parent_sku, d.color, d.size,
           (array_agg(pp2.sku ORDER BY pp2.updated_at DESC NULLS LAST))[1] AS correct_sku,
           (array_agg(pp2.barcode ORDER BY pp2.updated_at DESC NULLS LAST))[1] AS correct_barcode
    FROM divergent d
    JOIN pos_products pp2
      ON pp2.parent_sku = d.parent_sku
     AND coalesce(pp2.color,'') = coalesce(d.color,'')
     AND coalesce(pp2.size,'')  = coalesce(d.size,'')
     AND coalesce(pp2.barcode,'') <> coalesce(d.barcode,'')
    WHERE EXISTS (
      SELECT 1 FROM product_variants v
      WHERE (coalesce(pp2.barcode,'') <> '' AND v.gtin = pp2.barcode) OR v.sku = pp2.sku
    )
    GROUP BY d.parent_sku, d.color, d.size
  ),
  agg_variant AS (
    SELECT d.parent_sku,
           d.sku,
           max(d.barcode) AS barcode,
           max(d.color)   AS color,
           max(d.size)    AS size,
           count(DISTINCT d.store_id) AS store_count,
           sum(coalesce(d.stock,0))   AS divergent_stock_sum,
           cs.correct_sku,
           cs.correct_barcode
    FROM divergent d
    LEFT JOIN correct_sibling cs
      ON cs.parent_sku = d.parent_sku
     AND coalesce(cs.color,'') = coalesce(d.color,'')
     AND coalesce(cs.size,'')  = coalesce(d.size,'')
    GROUP BY d.parent_sku, d.sku, cs.correct_sku, cs.correct_barcode
  ),
  parents AS (
    SELECT d.parent_sku,
           trim(regexp_replace(max(d.name), '\s*-\s*[^-]*$', '')) AS parent_name,
           EXISTS(SELECT 1 FROM products_master m WHERE m.sku_root = d.parent_sku) AS has_master,
           count(DISTINCT d.sku) AS total_divergent_variants,
           sum(coalesce(d.stock,0)) AS total_divergent_stock
    FROM divergent d
    GROUP BY d.parent_sku
  )
  SELECT
    p.parent_sku,
    p.parent_name,
    p.has_master,
    p.total_divergent_variants,
    p.total_divergent_stock,
    (SELECT jsonb_agg(to_jsonb(av) ORDER BY av.color, av.size)
       FROM agg_variant av WHERE av.parent_sku = p.parent_sku) AS variants
  FROM parents p
  WHERE (
    p_search IS NULL OR p_search = ''
    OR p.parent_sku ILIKE '%'||p_search||'%'
    OR p.parent_name ILIKE '%'||p_search||'%'
    OR EXISTS (SELECT 1 FROM divergent d WHERE d.parent_sku = p.parent_sku
               AND (d.sku ILIKE '%'||p_search||'%' OR d.barcode ILIKE '%'||p_search||'%'))
  )
  ORDER BY p.total_divergent_stock DESC, p.parent_sku
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.list_pos_estoque_divergences_grouped(text,int,int) TO authenticated, service_role;


-- 2) Excluir uma variação divergente (todas as lojas), migrando estoque para o cadastro correto
CREATE OR REPLACE FUNCTION public.delete_pos_divergent_variant(
  p_parent_sku text,
  p_barcode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_deleted int := 0;
  v_stock_migrated numeric := 0;
  v_stores_affected int := 0;
  v_correct_sku text;
  v_correct_barcode text;
  v_color text;
  v_size text;
  r RECORD;
  v_correct_id uuid;
  v_correct_prev numeric;
  v_correct_new numeric;
BEGIN
  IF coalesce(p_parent_sku,'') = '' OR coalesce(p_barcode,'') = '' THEN
    RAISE EXCEPTION 'parent_sku e barcode são obrigatórios';
  END IF;

  -- Descobre cor/tamanho da variação divergente
  SELECT max(color), max(size)
    INTO v_color, v_size
  FROM pos_products
  WHERE parent_sku = p_parent_sku AND barcode = p_barcode;

  IF v_color IS NULL AND v_size IS NULL THEN
    RAISE EXCEPTION 'Divergente não encontrado (parent=%, barcode=%)', p_parent_sku, p_barcode;
  END IF;

  -- Localiza o cadastro correto (irmão vinculado ao Módulo Estoque)
  SELECT pp2.sku, pp2.barcode
    INTO v_correct_sku, v_correct_barcode
  FROM pos_products pp2
  WHERE pp2.parent_sku = p_parent_sku
    AND coalesce(pp2.color,'') = coalesce(v_color,'')
    AND coalesce(pp2.size,'')  = coalesce(v_size,'')
    AND coalesce(pp2.barcode,'') <> coalesce(p_barcode,'')
    AND EXISTS (
      SELECT 1 FROM product_variants v
      WHERE (coalesce(pp2.barcode,'') <> '' AND v.gtin = pp2.barcode) OR v.sku = pp2.sku
    )
  ORDER BY pp2.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_correct_barcode IS NULL THEN
    RAISE EXCEPTION 'Nenhum cadastro correto vinculado ao Módulo Estoque para esta variação; rode Unificar antes.';
  END IF;

  -- Loop nas linhas divergentes por loja
  FOR r IN
    SELECT id, store_id, stock, price, cost_price, name, size, color, category, parent_sku
    FROM pos_products
    WHERE parent_sku = p_parent_sku AND barcode = p_barcode
  LOOP
    v_stores_affected := v_stores_affected + 1;

    -- Se tem estoque, migra
    IF coalesce(r.stock,0) > 0 THEN
      -- localiza linha correta nessa loja
      SELECT id, stock INTO v_correct_id, v_correct_prev
      FROM pos_products
      WHERE parent_sku = p_parent_sku
        AND barcode = v_correct_barcode
        AND store_id = r.store_id
      LIMIT 1;

      IF v_correct_id IS NULL THEN
        -- cria a linha correta na loja copiando dados do divergente
        INSERT INTO pos_products(store_id, sku, barcode, name, price, cost_price, stock, parent_sku, size, color, category, is_active)
        VALUES (r.store_id, v_correct_sku, v_correct_barcode, r.name, r.price, r.cost_price, 0, r.parent_sku, r.size, r.color, r.category, true)
        RETURNING id, stock INTO v_correct_id, v_correct_prev;
      END IF;

      v_correct_new := coalesce(v_correct_prev,0) + r.stock;
      UPDATE pos_products SET stock = v_correct_new, updated_at = now() WHERE id = v_correct_id;

      -- saída no divergente
      INSERT INTO pos_stock_adjustments(store_id, product_id, sku, barcode, product_name, direction, quantity, previous_stock, new_stock, reason)
      VALUES (r.store_id, r.id, r.sku, p_barcode, r.name, 'out', r.stock, r.stock, 0, 'Fusão de cadastro duplicado PDV');

      -- entrada no correto
      INSERT INTO pos_stock_adjustments(store_id, product_id, sku, barcode, product_name, direction, quantity, previous_stock, new_stock, reason)
      VALUES (r.store_id, v_correct_id, v_correct_sku, v_correct_barcode, r.name, 'in', r.stock, coalesce(v_correct_prev,0), v_correct_new, 'Fusão de cadastro duplicado PDV');

      v_stock_migrated := v_stock_migrated + r.stock;
    END IF;

    DELETE FROM pos_products WHERE id = r.id;
    v_rows_deleted := v_rows_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'rows_deleted', v_rows_deleted,
    'stock_migrated', v_stock_migrated,
    'stores_affected', v_stores_affected,
    'correct_sku', v_correct_sku,
    'correct_barcode', v_correct_barcode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_pos_divergent_variant(text,text) TO authenticated, service_role;


-- 3) Excluir todos os divergentes de um pai (batch)
CREATE OR REPLACE FUNCTION public.delete_pos_divergent_parent(p_parent_sku text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bc text;
  v_rows int := 0;
  v_stock numeric := 0;
  v_stores int := 0;
  v_skipped int := 0;
  v_res jsonb;
BEGIN
  FOR bc IN
    SELECT DISTINCT pp.barcode
    FROM pos_products pp
    WHERE pp.parent_sku = p_parent_sku
      AND coalesce(pp.barcode,'') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.gtin = pp.barcode OR v.sku = pp.sku
      )
      -- só barcodes que TEM irmão correto (evita erro no loop)
      AND EXISTS (
        SELECT 1 FROM pos_products pp2
        WHERE pp2.parent_sku = pp.parent_sku
          AND coalesce(pp2.color,'') = coalesce(pp.color,'')
          AND coalesce(pp2.size,'')  = coalesce(pp.size,'')
          AND coalesce(pp2.barcode,'') <> coalesce(pp.barcode,'')
          AND EXISTS (SELECT 1 FROM product_variants v
                      WHERE v.gtin = pp2.barcode OR v.sku = pp2.sku)
      )
  LOOP
    BEGIN
      v_res := public.delete_pos_divergent_variant(p_parent_sku, bc);
      v_rows   := v_rows   + coalesce((v_res->>'rows_deleted')::int, 0);
      v_stock  := v_stock  + coalesce((v_res->>'stock_migrated')::numeric, 0);
      v_stores := v_stores + coalesce((v_res->>'stores_affected')::int, 0);
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'rows_deleted', v_rows,
    'stock_migrated', v_stock,
    'stores_affected', v_stores,
    'variants_skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_pos_divergent_parent(text) TO authenticated, service_role;
