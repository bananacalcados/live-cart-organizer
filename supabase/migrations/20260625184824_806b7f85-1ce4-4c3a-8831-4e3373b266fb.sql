
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.backfill_pos_products_from_sales(p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_candidates int := 0;
  v_sample jsonb;
  r record;
  v_base text;
  v_size text;
  v_color text;
  v_parent text;
  v_variant text;
  v_barcode text;
BEGIN
  -- Combos (loja, sku) que JÁ foram vendidos mas não existem em pos_products em loja nenhuma
  CREATE TEMP TABLE _phantoms ON COMMIT DROP AS
  WITH sold AS (
    SELECT DISTINCT ON (s.store_id, si.sku)
      s.store_id,
      si.sku,
      si.product_name,
      si.variant_name,
      si.barcode,
      si.tiny_product_id,
      si.unit_price,
      si.category,
      si.created_at
    FROM pos_sale_items si
    JOIN pos_sales s ON s.id = si.sale_id
    WHERE si.sku IS NOT NULL AND si.sku <> ''
      AND si.sku NOT ILIKE 'TESTE%' AND si.sku NOT ILIKE 'POS-%'
      AND COALESCE(si.product_name,'') NOT ILIKE '%produto teste%'
    ORDER BY s.store_id, si.sku,
             (si.barcode IS NOT NULL) DESC,
             (si.variant_name IS NOT NULL) DESC,
             si.created_at DESC
  )
  SELECT sold.*
  FROM sold
  WHERE NOT EXISTS (SELECT 1 FROM pos_products pp WHERE pp.sku = sold.sku);

  SELECT count(*) INTO v_candidates FROM _phantoms;

  FOR r IN SELECT * FROM _phantoms LOOP
    -- base = nome sem os 2 últimos segmentos " - COR - TAM" (quando houver)
    IF r.variant_name IS NOT NULL AND r.variant_name <> '' THEN
      v_base := r.product_name;
      -- variant_name no formato "COR / TAM" ou "TAM / COR"
      DECLARE a text; b text; BEGIN
        a := trim(split_part(r.variant_name,'/',1));
        b := trim(split_part(r.variant_name,'/',2));
        IF b ~ '^[0-9]{1,2}([./][0-9]{1,2})?$' THEN
          v_color := NULLIF(a,''); v_size := NULLIF(b,'');
        ELSIF a ~ '^[0-9]{1,2}([./][0-9]{1,2})?$' THEN
          v_size := NULLIF(a,''); v_color := NULLIF(b,'');
        ELSE
          v_color := NULLIF(a,''); v_size := NULLIF(b,'');
        END IF;
      END;
    ELSE
      v_base := regexp_replace(r.product_name, '(\s-\s[^-]+){2}\s*$', '');
      v_color := NULLIF(trim(regexp_replace(r.product_name, '^.*\s-\s([^-]+)\s-\s[^-]+\s*$', '\1')), r.product_name);
      v_size  := NULLIF(trim(regexp_replace(r.product_name, '^.*\s-\s([^-]+)\s*$', '\1')), r.product_name);
      IF v_color IS NULL THEN v_color := NULL; END IF;
    END IF;

    v_base := trim(v_base);
    v_parent := upper(regexp_replace(unaccent(coalesce(v_base,'')), '[^a-zA-Z0-9]+', '-', 'g'));
    v_parent := trim(both '-' from v_parent);
    IF v_parent = '' THEN v_parent := NULL; END IF;

    v_variant := trim(coalesce(v_size,'') || ' ' || coalesce(v_color,''));

    v_barcode := COALESCE(NULLIF(r.barcode,''), CASE WHEN r.sku ~ '^[0-9]{8,14}$' THEN r.sku ELSE '' END);

    IF p_commit THEN
      INSERT INTO pos_products (
        store_id, tiny_id, sku, name, variant, size, color, category,
        price, barcode, stock, is_active, auto_classified, parent_sku, synced_at
      ) VALUES (
        r.store_id,
        CASE WHEN r.tiny_product_id ~ '^[0-9]+$' THEN r.tiny_product_id::bigint ELSE NULL END,
        r.sku,
        coalesce(NULLIF(r.product_name,''), r.sku),
        v_variant,
        v_size,
        v_color,
        r.category,
        coalesce(r.unit_price,0),
        v_barcode,
        0, -- estoque parte de 0; balanço/contagem passa a ser a fonte da verdade
        true,
        false,
        v_parent,
        now()
      )
      ON CONFLICT DO NOTHING;
      v_inserted := v_inserted + 1;
    END IF;

    IF v_sample IS NULL OR jsonb_array_length(v_sample) < 8 THEN
      v_sample := coalesce(v_sample,'[]'::jsonb) || jsonb_build_object(
        'sku', r.sku, 'name', r.product_name, 'parent_sku', v_parent,
        'size', v_size, 'color', v_color, 'barcode', v_barcode
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'commit', p_commit,
    'candidates', v_candidates,
    'inserted', v_inserted,
    'sample', coalesce(v_sample,'[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_pos_products_from_sales(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.backfill_pos_products_from_sales(boolean) TO service_role;
