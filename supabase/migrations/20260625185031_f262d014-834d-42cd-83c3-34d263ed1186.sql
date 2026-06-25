
CREATE OR REPLACE FUNCTION public.backfill_pos_products_from_sales(
  p_commit boolean DEFAULT false,
  p_clean_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_candidates int := 0;
  v_skipped_dirty int := 0;
  v_sample jsonb;
  r record;
  v_base text;
  v_size text;
  v_color text;
  v_parent text;
  v_variant text;
  v_barcode text;
  v_sku text;
  v_is_dirty boolean;
  v_parts text[];
  v_n int;
  v_last text;
  v_prev text;
BEGIN
  CREATE TEMP TABLE _phantoms ON COMMIT DROP AS
  WITH sold AS (
    SELECT DISTINCT ON (s.store_id, trim(si.sku))
      s.store_id, trim(si.sku) AS sku, si.product_name, si.variant_name,
      trim(coalesce(si.barcode,'')) AS barcode, si.tiny_product_id, si.unit_price, si.category, si.created_at
    FROM pos_sale_items si
    JOIN pos_sales s ON s.id = si.sale_id
    WHERE si.sku IS NOT NULL AND trim(si.sku) <> ''
      AND trim(si.sku) NOT ILIKE 'TESTE%' AND trim(si.sku) NOT ILIKE 'POS-%'
      AND COALESCE(si.product_name,'') NOT ILIKE '%produto teste%'
    ORDER BY s.store_id, trim(si.sku),
             (si.barcode IS NOT NULL) DESC, (si.variant_name IS NOT NULL) DESC, si.created_at DESC
  )
  SELECT sold.* FROM sold
  WHERE NOT EXISTS (SELECT 1 FROM pos_products pp WHERE pp.sku = sold.sku);

  SELECT count(*) INTO v_candidates FROM _phantoms;

  FOR r IN SELECT * FROM _phantoms LOOP
    v_sku := r.sku;
    v_is_dirty := (r.product_name ~ '[\u2013\u2014]');
    v_size := NULL; v_color := NULL;

    IF r.variant_name IS NOT NULL AND r.variant_name <> '' THEN
      v_base := r.product_name;
      v_last := trim(split_part(r.variant_name,'/',1));
      v_prev := trim(split_part(r.variant_name,'/',2));
      IF v_prev ~ '^[0-9]{1,2}([./][0-9]{1,2})?$' THEN
        v_color := NULLIF(v_last,''); v_size := NULLIF(v_prev,'');
      ELSIF v_last ~ '^[0-9]{1,2}([./][0-9]{1,2})?$' THEN
        v_size := NULLIF(v_last,''); v_color := NULLIF(v_prev,'');
      ELSE
        v_color := NULLIF(v_last,''); v_size := NULLIF(v_prev,'');
      END IF;
    ELSE
      v_parts := regexp_split_to_array(r.product_name, '\s-\s');
      v_n := array_length(v_parts,1);
      IF v_n >= 3 THEN
        v_base := array_to_string(v_parts[1:v_n-2], ' - ');
        v_last := trim(v_parts[v_n]);
        v_prev := trim(v_parts[v_n-1]);
        IF v_last ~ '^[0-9]{1,2}([./][0-9]{1,2})?$' THEN
          v_size := v_last; v_color := NULLIF(v_prev,'');
        ELSIF v_prev ~ '^[0-9]{1,2}([./][0-9]{1,2})?$' THEN
          v_size := v_prev; v_color := NULLIF(v_last,'');
        ELSE
          v_color := NULLIF(v_last,''); v_size := NULLIF(v_prev,'');
        END IF;
      ELSE
        v_base := r.product_name;
      END IF;
    END IF;

    v_base := trim(v_base);
    v_parent := trim(both '-' from upper(regexp_replace(unaccent(coalesce(v_base,'')), '[^a-zA-Z0-9]+', '-', 'g')));
    IF v_parent = '' THEN v_parent := NULL; END IF;
    v_variant := trim(coalesce(v_size,'') || ' ' || coalesce(v_color,''));
    v_barcode := COALESCE(NULLIF(r.barcode,''), CASE WHEN v_sku ~ '^[0-9]{8,14}$' THEN v_sku ELSE '' END);

    IF p_clean_only AND v_is_dirty THEN
      v_skipped_dirty := v_skipped_dirty + 1;
      CONTINUE;
    END IF;

    IF p_commit THEN
      INSERT INTO pos_products (
        store_id, tiny_id, sku, name, variant, size, color, category,
        price, barcode, stock, is_active, auto_classified, parent_sku, synced_at
      ) VALUES (
        r.store_id,
        CASE WHEN r.tiny_product_id ~ '^[0-9]+$' THEN r.tiny_product_id::bigint ELSE NULL END,
        v_sku, coalesce(NULLIF(r.product_name,''), v_sku),
        v_variant, v_size, v_color, r.category,
        coalesce(r.unit_price,0), v_barcode, 0, true, false, v_parent, now()
      )
      ON CONFLICT DO NOTHING;
      v_inserted := v_inserted + 1;
    END IF;

    IF v_sample IS NULL OR jsonb_array_length(v_sample) < 10 THEN
      v_sample := coalesce(v_sample,'[]'::jsonb) || jsonb_build_object(
        'sku', v_sku, 'name', r.product_name, 'parent_sku', v_parent,
        'size', v_size, 'color', v_color, 'barcode', v_barcode);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'commit', p_commit, 'clean_only', p_clean_only,
    'candidates', v_candidates, 'skipped_dirty', v_skipped_dirty,
    'inserted', v_inserted, 'sample', coalesce(v_sample,'[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_pos_products_from_sales(boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.backfill_pos_products_from_sales(boolean, boolean) TO service_role;
