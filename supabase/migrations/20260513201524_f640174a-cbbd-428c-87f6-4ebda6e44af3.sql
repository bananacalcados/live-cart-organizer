
CREATE OR REPLACE FUNCTION public.apply_catalog_sync_from_pos(p_limit int DEFAULT 500, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_master_created int := 0;
  v_variant_created int := 0;
  v_variant_updated int := 0;
  v_skipped_sku_conflict int := 0;
  rec record;
  v_master_id uuid;
  v_variant_id uuid;
  v_sku_owner uuid;
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
    SELECT id INTO v_master_id FROM products_master m
      WHERE product_name_key(m.name) = product_name_key(rec.base_name)
      ORDER BY (CASE WHEN m.ncm IS NOT NULL THEN 0 ELSE 1 END),
               (SELECT count(*) FROM product_variants pv WHERE pv.master_id = m.id) DESC,
               m.created_at ASC
      LIMIT 1;

    IF v_master_id IS NULL THEN
      INSERT INTO products_master (sku_root, name, brand, cost_price, sale_price, is_active, tiny_product_id)
      VALUES (
        coalesce(rec.sku, 'AUTO-' || substr(md5(rec.base_name), 1, 10)),
        rec.base_name, NULL, 0, coalesce(rec.price, 0), true, rec.tiny_id
      ) RETURNING id INTO v_master_id;
      v_master_created := v_master_created + 1;
      INSERT INTO catalog_sync_log(run_id, operation, master_id, base_name, color, size, details)
      VALUES (v_run_id, 'create_master', v_master_id, rec.base_name, rec.norm_color, rec.norm_size,
              jsonb_build_object('sku', rec.sku, 'tiny_id', rec.tiny_id));
    ELSE
      UPDATE products_master SET tiny_product_id = coalesce(tiny_product_id, rec.tiny_id),
                                 sale_price = CASE WHEN sale_price = 0 THEN coalesce(rec.price, 0) ELSE sale_price END
       WHERE id = v_master_id AND (tiny_product_id IS NULL OR sale_price = 0);
    END IF;

    -- variant match dentro deste master
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
      -- antes de criar, checa se SKU já existe em outro master (conflito → Etapa 2 resolve)
      v_sku_owner := NULL;
      IF rec.sku IS NOT NULL AND rec.sku <> '' THEN
        SELECT pv.master_id INTO v_sku_owner FROM product_variants pv WHERE pv.sku = rec.sku LIMIT 1;
      END IF;

      IF v_sku_owner IS NOT NULL THEN
        v_skipped_sku_conflict := v_skipped_sku_conflict + 1;
        INSERT INTO catalog_sync_log(run_id, operation, master_id, base_name, color, size, details)
        VALUES (v_run_id, 'skip_sku_conflict', v_master_id, rec.base_name, rec.norm_color, rec.norm_size,
                jsonb_build_object('sku', rec.sku, 'gtin', rec.gtin, 'existing_master_id', v_sku_owner));
      ELSE
        INSERT INTO product_variants (master_id, sku, gtin, color, size, initial_stock, is_active)
        VALUES (v_master_id, coalesce(rec.sku, ''), rec.gtin, rec.norm_color, rec.norm_size, 0, true)
        RETURNING id INTO v_variant_id;
        v_variant_created := v_variant_created + 1;
        INSERT INTO catalog_sync_log(run_id, operation, master_id, variant_id, base_name, color, size, details)
        VALUES (v_run_id, 'create_variant', v_master_id, v_variant_id, rec.base_name, rec.norm_color, rec.norm_size,
                jsonb_build_object('sku', rec.sku, 'gtin', rec.gtin));
      END IF;
    ELSE
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
    'skipped_sku_conflict', v_skipped_sku_conflict,
    'offset', p_offset,
    'limit', p_limit
  );
END $$;
