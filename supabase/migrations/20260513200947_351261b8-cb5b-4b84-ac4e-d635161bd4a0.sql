
-- ============================================================
-- ETAPA 1: Sincronizar pos_products → products_master/product_variants
-- ============================================================

-- Tabela de log
CREATE TABLE IF NOT EXISTS public.catalog_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  operation text NOT NULL, -- 'create_master' | 'update_master' | 'create_variant' | 'update_variant' | 'skip'
  master_id uuid,
  variant_id uuid,
  base_name text,
  color text,
  size text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_sync_log_run ON public.catalog_sync_log(run_id, created_at);

ALTER TABLE public.catalog_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read catalog sync log" ON public.catalog_sync_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Helper: extrai nome-pai removendo sufixos " - SIZE - COLOR" ou " - SIZE" ou " - COLOR"
CREATE OR REPLACE FUNCTION public.extract_base_product_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  parts text[];
  n int;
  last_part text;
  prev_part text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  parts := string_to_array(p_name, ' - ');
  n := array_length(parts, 1);
  IF n IS NULL OR n < 2 THEN RETURN btrim(p_name); END IF;
  last_part := btrim(parts[n]);
  IF n >= 3 THEN
    prev_part := btrim(parts[n-1]);
    IF prev_part ~ '^\d{1,2}([,\.]\d)?$' THEN
      RETURN btrim(array_to_string(parts[1:n-2], ' - '));
    END IF;
  END IF;
  IF last_part ~ '^\d{1,2}([,\.]\d)?$' THEN
    RETURN btrim(array_to_string(parts[1:n-1], ' - '));
  END IF;
  -- caso só cor: tem que ser texto puro curto (até 3 palavras)
  IF last_part ~* '^[a-zà-ÿ]+( [a-zà-ÿ]+){0,2}$' THEN
    RETURN btrim(array_to_string(parts[1:n-1], ' - '));
  END IF;
  RETURN btrim(p_name);
END $$;

-- Helper: chave de comparação (lowercase + sem acento + sem espaços extras)
CREATE OR REPLACE FUNCTION public.product_name_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(regexp_replace(unaccent(coalesce(p_name,'')), '\s+', ' ', 'g'))
$$;

-- Helper: title case simples
CREATE OR REPLACE FUNCTION public.title_case_color(p_color text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_color IS NULL OR btrim(p_color) = '' THEN NULL
    ELSE initcap(lower(btrim(p_color))) END
$$;

-- ANÁLISE (dry-run)
CREATE OR REPLACE FUNCTION public.analyze_catalog_sync_from_pos()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  WITH pos_grouped AS (
    SELECT
      extract_base_product_name(name) AS base_name,
      title_case_color(color) AS norm_color,
      btrim(size) AS norm_size,
      max(sku) AS sku,
      max(barcode) AS gtin,
      max(price) AS price,
      max(tiny_id::text) AS tiny_id
    FROM pos_products
    WHERE name IS NOT NULL AND btrim(name) <> ''
    GROUP BY 1,2,3
  ),
  master_match AS (
    SELECT pg.*,
      (SELECT id FROM products_master m
        WHERE product_name_key(m.name) = product_name_key(pg.base_name)
        ORDER BY (CASE WHEN m.ncm IS NOT NULL THEN 0 ELSE 1 END),
                 (SELECT count(*) FROM product_variants pv WHERE pv.master_id = m.id) DESC,
                 m.created_at ASC
        LIMIT 1) AS existing_master_id
    FROM pos_grouped pg
  ),
  variant_match AS (
    SELECT mm.*,
      CASE WHEN mm.existing_master_id IS NOT NULL THEN
        (SELECT pv.id FROM product_variants pv
          WHERE pv.master_id = mm.existing_master_id
            AND coalesce(title_case_color(pv.color),'') = coalesce(mm.norm_color,'')
            AND coalesce(btrim(pv.size),'') = coalesce(mm.norm_size,'')
          LIMIT 1)
      ELSE NULL END AS existing_variant_id
    FROM master_match mm
  )
  SELECT jsonb_build_object(
    'pos_groups_total', count(*),
    'masters_to_create', count(*) FILTER (WHERE existing_master_id IS NULL),
    'masters_existing', count(DISTINCT existing_master_id) FILTER (WHERE existing_master_id IS NOT NULL),
    'variants_to_create', count(*) FILTER (WHERE existing_variant_id IS NULL),
    'variants_existing', count(*) FILTER (WHERE existing_variant_id IS NOT NULL),
    'sample_new_masters', (
      SELECT jsonb_agg(jsonb_build_object('base_name', base_name, 'color', norm_color, 'size', norm_size, 'sku', sku))
      FROM (SELECT DISTINCT base_name, norm_color, norm_size, sku FROM variant_match WHERE existing_master_id IS NULL LIMIT 10) s
    ),
    'sample_new_variants', (
      SELECT jsonb_agg(jsonb_build_object('base_name', base_name, 'color', norm_color, 'size', norm_size, 'sku', sku))
      FROM (SELECT base_name, norm_color, norm_size, sku FROM variant_match WHERE existing_master_id IS NOT NULL AND existing_variant_id IS NULL LIMIT 10) s
    )
  ) INTO v
  FROM variant_match;
  RETURN v;
END $$;

-- APLICAÇÃO em lote
CREATE OR REPLACE FUNCTION public.apply_catalog_sync_from_pos(p_limit int DEFAULT 500, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_master_created int := 0;
  v_master_updated int := 0;
  v_variant_created int := 0;
  v_variant_updated int := 0;
  v_skipped int := 0;
  rec record;
  v_master_id uuid;
  v_variant_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  FOR rec IN
    SELECT
      extract_base_product_name(name) AS base_name,
      title_case_color(color) AS norm_color,
      btrim(size) AS norm_size,
      max(sku) AS sku,
      max(barcode) AS gtin,
      max(price) AS price,
      max(tiny_id::text) AS tiny_id
    FROM pos_products
    WHERE name IS NOT NULL AND btrim(name) <> ''
    GROUP BY 1,2,3
    ORDER BY 1,2,3
    OFFSET p_offset LIMIT p_limit
  LOOP
    -- master match (case-insensitive, melhor candidato preserva NCM/variants/idade)
    SELECT id INTO v_master_id FROM products_master m
      WHERE product_name_key(m.name) = product_name_key(rec.base_name)
      ORDER BY (CASE WHEN m.ncm IS NOT NULL THEN 0 ELSE 1 END),
               (SELECT count(*) FROM product_variants pv WHERE pv.master_id = m.id) DESC,
               m.created_at ASC
      LIMIT 1;

    IF v_master_id IS NULL THEN
      INSERT INTO products_master (
        sku_root, name, brand, cost_price, sale_price, is_active, tiny_product_id
      ) VALUES (
        coalesce(rec.sku, 'AUTO-' || substr(md5(rec.base_name), 1, 10)),
        rec.base_name,
        NULL,
        0,
        coalesce(rec.price, 0),
        true,
        rec.tiny_id
      ) RETURNING id INTO v_master_id;
      v_master_created := v_master_created + 1;
      INSERT INTO catalog_sync_log(run_id, operation, master_id, base_name, color, size, details)
      VALUES (v_run_id, 'create_master', v_master_id, rec.base_name, rec.norm_color, rec.norm_size,
              jsonb_build_object('sku', rec.sku, 'tiny_id', rec.tiny_id));
    ELSE
      -- preencher tiny_product_id se vazio
      UPDATE products_master SET tiny_product_id = coalesce(tiny_product_id, rec.tiny_id),
                                 sale_price = CASE WHEN sale_price = 0 THEN coalesce(rec.price, 0) ELSE sale_price END
       WHERE id = v_master_id AND (tiny_product_id IS NULL OR sale_price = 0);
    END IF;

    -- variant match
    SELECT pv.id INTO v_variant_id FROM product_variants pv
      WHERE pv.master_id = v_master_id
        AND coalesce(title_case_color(pv.color),'') = coalesce(rec.norm_color,'')
        AND coalesce(btrim(pv.size),'') = coalesce(rec.norm_size,'')
      LIMIT 1;

    IF v_variant_id IS NULL AND rec.gtin IS NOT NULL THEN
      SELECT pv.id INTO v_variant_id FROM product_variants pv
        WHERE pv.master_id = v_master_id AND pv.gtin = rec.gtin LIMIT 1;
    END IF;

    IF v_variant_id IS NULL THEN
      INSERT INTO product_variants (master_id, sku, gtin, color, size, initial_stock, is_active)
      VALUES (v_master_id, coalesce(rec.sku, ''), rec.gtin, rec.norm_color, rec.norm_size, 0, true)
      RETURNING id INTO v_variant_id;
      v_variant_created := v_variant_created + 1;
      INSERT INTO catalog_sync_log(run_id, operation, master_id, variant_id, base_name, color, size, details)
      VALUES (v_run_id, 'create_variant', v_master_id, v_variant_id, rec.base_name, rec.norm_color, rec.norm_size,
              jsonb_build_object('sku', rec.sku, 'gtin', rec.gtin));
    ELSE
      -- update somente campos vazios
      UPDATE product_variants SET
        sku = CASE WHEN coalesce(sku,'') = '' THEN coalesce(rec.sku, sku) ELSE sku END,
        gtin = coalesce(gtin, rec.gtin),
        color = CASE WHEN color IS NULL THEN rec.norm_color ELSE title_case_color(color) END
      WHERE id = v_variant_id;
      v_variant_updated := v_variant_updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'masters_created', v_master_created,
    'variants_created', v_variant_created,
    'variants_updated', v_variant_updated,
    'offset', p_offset,
    'limit', p_limit
  );
END $$;
