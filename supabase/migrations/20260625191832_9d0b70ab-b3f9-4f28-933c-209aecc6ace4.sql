
-- ============================================================
-- FASE 3 — Manter Estoque espelhado com o PDV (sem derivar de novo)
-- ============================================================

-- 1) CONSOLIDAÇÃO: reagrupar variações fragmentadas sob o pai correto (sku_root = parent_sku do PDV)
CREATE OR REPLACE FUNCTION public.consolidate_estoque_parents_by_pos(p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parents_created int := 0;
  v_variants_reparented int := 0;
  v_dup_variants_removed int := 0;
  v_parents_emptied int := 0;
  v_targets int := 0;
  v_sample jsonb;
BEGIN
  -- Mapeia cada variação (por GTIN) ao slug de pai do PDV + nome-base limpo
  CREATE TEMP TABLE _vmap ON COMMIT DROP AS
  SELECT DISTINCT ON (v.id)
    v.id AS variant_id,
    v.master_id AS cur_master,
    v.color, v.size,
    m.sku_root AS cur_root,
    pp.parent_sku AS slug,
    trim(regexp_replace(pp.name, '\s*-\s*.*$', '')) AS base_name
  FROM product_variants v
  JOIN products_master m ON m.id = v.master_id
  JOIN pos_products pp ON pp.barcode = v.gtin AND pp.barcode <> ''
  WHERE pp.parent_sku IS NOT NULL AND pp.parent_sku <> ''
    AND pp.parent_sku NOT LIKE 'POS-%'
    AND pp.parent_sku <> 'TESTE-005'
    AND lower(coalesce(pp.name,'')) NOT LIKE '%produto teste%'
  ORDER BY v.id, pp.synced_at DESC NULLS LAST;

  CREATE TEMP TABLE _targets ON COMMIT DROP AS
  SELECT slug, max(base_name) AS base_name
  FROM _vmap GROUP BY slug;

  SELECT count(*) INTO v_targets FROM _targets;

  IF NOT p_commit THEN
    -- DRY RUN: apenas conta o que mudaria
    SELECT count(*) INTO v_parents_created
      FROM _targets t WHERE NOT EXISTS (SELECT 1 FROM products_master m WHERE m.sku_root = t.slug);
    SELECT count(*) INTO v_variants_reparented
      FROM _vmap vm WHERE vm.cur_root <> vm.slug;

    SELECT jsonb_agg(t) INTO v_sample FROM (
      SELECT vm.slug, vm.base_name, count(*) AS variacoes
      FROM _vmap vm WHERE vm.cur_root <> vm.slug
      GROUP BY vm.slug, vm.base_name
      ORDER BY count(*) DESC LIMIT 30
    ) t;

    RETURN jsonb_build_object(
      'dry_run', true,
      'slugs_alvo', v_targets,
      'pais_a_criar', v_parents_created,
      'variacoes_a_reagrupar', v_variants_reparented,
      'amostra', COALESCE(v_sample, '[]'::jsonb)
    );
  END IF;

  -- COMMIT
  -- a) cria os pais canônicos (sku_root = slug) que ainda não existem
  INSERT INTO products_master (sku_root, name, is_active, needs_review, review_reason)
  SELECT t.slug, t.base_name, true, true, 'Consolidado por referência (PDV)'
  FROM _targets t
  WHERE NOT EXISTS (SELECT 1 FROM products_master m WHERE m.sku_root = t.slug)
  ON CONFLICT (sku_root) DO NOTHING;
  GET DIAGNOSTICS v_parents_created = ROW_COUNT;

  -- b) remove variações duplicadas (mesma cor/tamanho já existente no pai canônico)
  WITH tgt AS (
    SELECT vm.variant_id, vm.color, vm.size, m.id AS canon
    FROM _vmap vm JOIN products_master m ON m.sku_root = vm.slug
    WHERE m.id <> vm.cur_master
  ),
  dups AS (
    SELECT t.variant_id FROM tgt t
    WHERE EXISTS (
      SELECT 1 FROM product_variants ex
      WHERE ex.master_id = t.canon
        AND ex.color IS NOT DISTINCT FROM t.color
        AND ex.size IS NOT DISTINCT FROM t.size
        AND ex.id <> t.variant_id
    )
  )
  DELETE FROM product_variants WHERE id IN (SELECT variant_id FROM dups);
  GET DIAGNOSTICS v_dup_variants_removed = ROW_COUNT;

  -- c) reagrupa as variações restantes sob o pai canônico
  UPDATE product_variants v
  SET master_id = m.id, last_sync_source = 'consolidation', updated_at = now()
  FROM _vmap vm
  JOIN products_master m ON m.sku_root = vm.slug
  WHERE v.id = vm.variant_id AND v.master_id <> m.id;
  GET DIAGNOSTICS v_variants_reparented = ROW_COUNT;

  -- d) remove pais fragmentados (sku_root numérico) que ficaram sem nenhuma variação
  DELETE FROM products_master m
  WHERE m.sku_root ~ '^\d{4,7}$'
    AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.master_id = m.id);
  GET DIAGNOSTICS v_parents_emptied = ROW_COUNT;

  RETURN jsonb_build_object(
    'dry_run', false,
    'slugs_alvo', v_targets,
    'pais_criados', v_parents_created,
    'variacoes_reagrupadas', v_variants_reparented,
    'variacoes_duplicadas_removidas', v_dup_variants_removed,
    'pais_vazios_removidos', v_parents_emptied
  );
END;
$function$;

-- 2) TRIGGER: toda inserção/alteração estrutural em pos_products espelha pai+filho no Estoque
CREATE OR REPLACE FUNCTION public.sync_pos_product_to_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_master_id uuid;
  v_base_name text;
  v_gtin text;
BEGIN
  IF NEW.parent_sku IS NULL OR NEW.parent_sku = '' THEN RETURN NEW; END IF;
  IF NEW.parent_sku LIKE 'POS-%' OR NEW.parent_sku = 'TESTE-005' THEN RETURN NEW; END IF;
  IF lower(coalesce(NEW.name,'')) LIKE '%produto teste%' THEN RETURN NEW; END IF;
  IF NEW.name ~ '[–—]' THEN RETURN NEW; END IF; -- ignora produtos de anúncio/marketing

  v_gtin := NULLIF(NEW.barcode, '');
  v_base_name := trim(regexp_replace(NEW.name, '\s*-\s*.*$', ''));

  SELECT id INTO v_master_id FROM products_master WHERE sku_root = NEW.parent_sku;
  IF v_master_id IS NULL THEN
    INSERT INTO products_master (sku_root, name, category, brand, is_active, needs_review, review_reason)
    VALUES (NEW.parent_sku, v_base_name, NEW.category, NEW.brand, true, true, 'Auto-sync do PDV')
    ON CONFLICT (sku_root) DO NOTHING;
    SELECT id INTO v_master_id FROM products_master WHERE sku_root = NEW.parent_sku;
  END IF;
  IF v_master_id IS NULL THEN RETURN NEW; END IF;

  IF v_gtin IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM product_variants WHERE gtin = v_gtin) THEN
      INSERT INTO product_variants (master_id, sku, gtin, color, size,
                                    sale_price_override, cost_price_override, initial_stock,
                                    is_active, last_sync_source)
      VALUES (v_master_id, NEW.sku, v_gtin, NEW.color, NEW.size,
              NULLIF(NEW.price,0), NULLIF(NEW.cost_price,0), NEW.stock, true, 'pos_autosync')
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM product_variants WHERE sku = NEW.sku) THEN
      INSERT INTO product_variants (master_id, sku, color, size,
                                    sale_price_override, cost_price_override, initial_stock,
                                    is_active, last_sync_source)
      VALUES (v_master_id, NEW.sku, NEW.color, NEW.size,
              NULLIF(NEW.price,0), NULLIF(NEW.cost_price,0), NEW.stock, true, 'pos_autosync')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- nunca quebrar a gravação do PDV por causa do espelhamento
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_pos_product_to_estoque ON public.pos_products;
CREATE TRIGGER trg_sync_pos_product_to_estoque
AFTER INSERT OR UPDATE OF parent_sku, barcode, sku, name, color, size
ON public.pos_products
FOR EACH ROW EXECUTE FUNCTION public.sync_pos_product_to_estoque();

-- 3) RPCs do painel de divergências (Módulo Estoque)
CREATE OR REPLACE FUNCTION public.pos_estoque_divergence_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT pp.* FROM pos_products pp
    WHERE pp.parent_sku IS NOT NULL AND pp.parent_sku <> ''
      AND pp.parent_sku NOT LIKE 'POS-%' AND pp.parent_sku <> 'TESTE-005'
      AND lower(coalesce(pp.name,'')) NOT LIKE '%produto teste%'
      AND pp.name !~ '[–—]'
  )
  SELECT jsonb_build_object(
    'nao_catalogados', (
      SELECT count(*) FROM base b
      WHERE NOT EXISTS (
        SELECT 1 FROM product_variants v
        WHERE (b.barcode <> '' AND v.gtin = b.barcode) OR v.sku = b.sku
      )
    ),
    'sem_gtin', (SELECT count(*) FROM base b WHERE coalesce(b.barcode,'') = ''),
    'pais_fragmentados', (
      SELECT count(*) FROM (
        SELECT m.sku_root FROM products_master m
        WHERE m.sku_root ~ '^\d{4,7}$'
          AND EXISTS (
            SELECT 1 FROM product_variants v
            JOIN pos_products pp ON pp.barcode = v.gtin AND pp.barcode <> ''
            WHERE v.master_id = m.id AND pp.parent_sku !~ '^\d{4,7}$'
          )
      ) f
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.list_pos_estoque_divergences(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  parent_sku text, name text, sku text, barcode text,
  size text, color text, category text, store_count bigint, sem_gtin boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT pp.parent_sku, pp.name, pp.sku, pp.barcode, pp.size, pp.color, pp.category
    FROM pos_products pp
    WHERE pp.parent_sku IS NOT NULL AND pp.parent_sku <> ''
      AND pp.parent_sku NOT LIKE 'POS-%' AND pp.parent_sku <> 'TESTE-005'
      AND lower(coalesce(pp.name,'')) NOT LIKE '%produto teste%'
      AND pp.name !~ '[–—]'
      AND NOT EXISTS (
        SELECT 1 FROM product_variants v
        WHERE (pp.barcode <> '' AND v.gtin = pp.barcode) OR v.sku = pp.sku
      )
      AND (p_search IS NULL OR p_search = '' OR
           pp.name ILIKE '%'||p_search||'%' OR pp.sku ILIKE '%'||p_search||'%'
           OR pp.barcode ILIKE '%'||p_search||'%' OR pp.parent_sku ILIKE '%'||p_search||'%')
  )
  SELECT parent_sku, max(name) AS name, sku, max(barcode) AS barcode,
         max(size) AS size, max(color) AS color, max(category) AS category,
         count(*) AS store_count,
         bool_or(coalesce(barcode,'') = '') AS sem_gtin
  FROM base
  GROUP BY parent_sku, sku
  ORDER BY parent_sku, sku
  LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.consolidate_estoque_parents_by_pos(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_estoque_divergence_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_pos_estoque_divergences(text, int, int) TO authenticated, service_role;
