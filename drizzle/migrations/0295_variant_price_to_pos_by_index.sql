CREATE OR REPLACE FUNCTION public._pos_ids_for_variants(p_skus text[], p_gtins text[], p_tiny text[])
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH st AS (SELECT array_agg(id) a FROM public.pos_stores)
  SELECT pp.id FROM public.pos_products pp, st WHERE pp.store_id = ANY(st.a) AND pp.sku = ANY(p_skus)
  UNION
  SELECT pp.id FROM public.pos_products pp, st WHERE pp.store_id = ANY(st.a) AND pp.barcode = ANY(p_gtins) AND pp.barcode <> ''
  UNION
  SELECT pp.id FROM public.pos_products pp WHERE pp.tiny_id::text = ANY(p_tiny)
$$;
REVOKE EXECUTE ON FUNCTION public._pos_ids_for_variants(text[], text[], text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.propagate_master_price_to_pos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_skus text[]; v_gtins text[]; v_tiny text[];
BEGIN
  IF public.is_sync_in_progress() THEN RETURN NEW; END IF;
  IF NEW.sale_price IS NULL OR NEW.sale_price <= 0 THEN RETURN NEW; END IF;
  SELECT array_agg(sku) FILTER (WHERE sku IS NOT NULL AND sku <> ''),
         array_agg(gtin) FILTER (WHERE gtin IS NOT NULL AND gtin <> ''),
         array_agg(tiny_variant_id) FILTER (WHERE tiny_variant_id IS NOT NULL)
    INTO v_skus, v_gtins, v_tiny
    FROM public.product_variants
   WHERE master_id = NEW.id AND COALESCE(sale_price_override,0) = 0;
  IF v_skus IS NULL AND v_gtins IS NULL AND v_tiny IS NULL THEN RETURN NEW; END IF;
  PERFORM set_config('app.sync_in_progress','on',true);
  UPDATE public.pos_products pp
     SET price = NEW.sale_price, updated_at = now()
   WHERE pp.id IN (SELECT public._pos_ids_for_variants(COALESCE(v_skus,'{}'), COALESCE(v_gtins,'{}'), COALESCE(v_tiny,'{}')))
     AND pp.price IS DISTINCT FROM NEW.sale_price;
  PERFORM set_config('app.sync_in_progress','off',true);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.propagate_variant_price_to_pos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_price numeric;
BEGIN
  IF public.is_sync_in_progress() THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(NEW.sale_price_override,0), m.sale_price)
    INTO v_price FROM public.products_master m WHERE m.id = NEW.master_id;
  IF v_price IS NULL OR v_price <= 0 THEN RETURN NEW; END IF;
  PERFORM set_config('app.sync_in_progress','on',true);
  UPDATE public.pos_products pp
     SET price = v_price, updated_at = now()
   WHERE pp.id IN (SELECT public._pos_ids_for_variants(
            CASE WHEN NULLIF(NEW.sku,'') IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.sku] END,
            CASE WHEN NULLIF(NEW.gtin,'') IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.gtin] END,
            CASE WHEN NEW.tiny_variant_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.tiny_variant_id] END))
     AND pp.price IS DISTINCT FROM v_price;
  PERFORM set_config('app.sync_in_progress','off',true);
  RETURN NEW;
END $$;