
CREATE OR REPLACE FUNCTION public.process_pos_sale_sale_event(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_item record;
  v_product record;
  v_target_store uuid;
  v_target_is_sim boolean;
  v_new_stock numeric;
  v_adj_id uuid;
  v_payload jsonb;
  v_shopify_items jsonb := '[]'::jsonb;
  v_codes text[];
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
BEGIN
  SELECT id, status, store_id, stock_source_store_id, seller_id, external_source
    INTO v_sale
  FROM public.pos_sales WHERE id = p_sale_id;

  IF v_sale.id IS NULL OR v_sale.status NOT IN ('completed', 'paid', 'conditional') THEN
    RETURN;
  END IF;

  v_target_store := COALESCE(v_sale.stock_source_store_id, v_sale.store_id);
  SELECT COALESCE(is_simulation, false) INTO v_target_is_sim FROM public.pos_stores WHERE id = v_target_store;

  FOR v_item IN
    SELECT sku, barcode, quantity, product_name, variant_name
    FROM public.pos_sale_items WHERE sale_id = p_sale_id
  LOOP
    IF COALESCE(v_item.quantity, 0) <= 0 THEN CONTINUE; END IF;

    v_codes := ARRAY(SELECT DISTINCT unnest FROM unnest(ARRAY[v_item.barcode, v_item.sku]) WHERE unnest IS NOT NULL AND unnest <> '');
    IF array_length(v_codes,1) IS NULL THEN CONTINUE; END IF;

    v_product := NULL;

    IF NOT v_target_is_sim THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p JOIN public.pos_stores s ON s.id = p.store_id
      WHERE p.store_id = v_target_store AND s.is_simulation = false
        AND (p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes))
        AND COALESCE(p.stock, 0) >= v_item.quantity
      ORDER BY (CASE WHEN p.barcode = ANY(v_codes) THEN 0 ELSE 1 END) LIMIT 1;
    END IF;

    IF v_product.id IS NULL THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p JOIN public.pos_stores s ON s.id = p.store_id
      WHERE s.is_simulation = false
        AND (p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes))
        AND COALESCE(p.stock, 0) >= v_item.quantity
      ORDER BY COALESCE(p.stock,0) DESC LIMIT 1;
    END IF;

    IF v_product.id IS NULL AND NOT v_target_is_sim THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p JOIN public.pos_stores s ON s.id = p.store_id
      WHERE p.store_id = v_target_store AND s.is_simulation = false
        AND (p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes)) LIMIT 1;
    END IF;

    IF v_product.id IS NULL THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p JOIN public.pos_stores s ON s.id = p.store_id
      WHERE s.is_simulation = false
        AND (p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes))
      ORDER BY COALESCE(p.stock,0) DESC LIMIT 1;
    END IF;

    IF v_product.id IS NULL THEN
      INSERT INTO public.inventory_sale_unmatched_items(
        sale_id, item_code, product_name, variant_name, quantity, store_id, external_source
      ) VALUES (
        p_sale_id, COALESCE(v_codes[1], ''), COALESCE(v_item.product_name, ''),
        v_item.variant_name, v_item.quantity, v_target_store, v_sale.external_source
      ) ON CONFLICT (sale_id, item_code) DO NOTHING;
      CONTINUE;
    END IF;

    v_new_stock := COALESCE(v_product.stock, 0) - v_item.quantity;

    -- INSERT antes do UPDATE para que a blindagem detecte e não duplique.
    INSERT INTO public.pos_stock_adjustments(
      store_id, product_id, tiny_id, sku, barcode, product_name,
      direction, quantity, previous_stock, new_stock, reason,
      seller_id, sale_id, sale_event, movement_type
    ) VALUES (
      v_product.store_id, v_product.id, v_product.tiny_id, v_product.sku, v_product.barcode,
      COALESCE(v_item.product_name, ''),
      'out', v_item.quantity, COALESCE(v_product.stock, 0), v_new_stock, 'pos_sale',
      v_sale.seller_id, p_sale_id, 'sale', 'venda'
    ) RETURNING id INTO v_adj_id;

    UPDATE public.pos_products SET stock = v_new_stock, updated_at = now() WHERE id = v_product.id;

    v_shopify_items := v_shopify_items || jsonb_build_object('barcode', v_product.barcode, 'sku', v_product.sku);
  END LOOP;

  IF jsonb_array_length(v_shopify_items) > 0 THEN
    v_payload := jsonb_build_object('sale_id', p_sale_id, 'sale_event', 'sale', 'items', v_shopify_items);
    PERFORM net.http_post(
      url     := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/shopify-mirror-stock',
      headers := jsonb_build_object('Content-Type','application/json','apikey', v_anon_key,'Authorization','Bearer '||v_anon_key),
      body    := v_payload
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_pos_sale_item_stock(p_sale_id uuid, p_sku text, p_barcode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adj record;
  v_cur numeric;
  v_new numeric;
  v_adj_id uuid;
BEGIN
  FOR v_adj IN
    SELECT id, store_id, product_id, tiny_id, sku, barcode, product_name, quantity
    FROM public.pos_stock_adjustments
    WHERE sale_id = p_sale_id AND sale_event = 'sale'
      AND (
        (NULLIF(p_barcode, '') IS NOT NULL AND barcode = p_barcode)
        OR (NULLIF(p_sku, '') IS NOT NULL AND sku = p_sku)
      )
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.pos_stock_adjustments
      WHERE sale_id = p_sale_id AND product_id = v_adj.product_id
        AND sale_event IN ('return', 'cancel')
    ) THEN CONTINUE; END IF;

    SELECT stock INTO v_cur FROM public.pos_products WHERE id = v_adj.product_id;
    IF v_cur IS NULL THEN CONTINUE; END IF;

    v_new := COALESCE(v_cur, 0) + v_adj.quantity;

    INSERT INTO public.pos_stock_adjustments(
      store_id, product_id, tiny_id, sku, barcode, product_name,
      direction, quantity, previous_stock, new_stock, reason,
      sale_id, sale_event, movement_type
    ) VALUES (
      v_adj.store_id, v_adj.product_id, v_adj.tiny_id, v_adj.sku, v_adj.barcode,
      COALESCE(v_adj.product_name, ''),
      'in', v_adj.quantity, COALESCE(v_cur, 0), v_new, 'conditional_return',
      p_sale_id, 'return', 'devolucao'
    ) RETURNING id INTO v_adj_id;

    UPDATE public.pos_products SET stock = v_new, updated_at = now() WHERE id = v_adj.product_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_pos_products_stock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_exists boolean;
  delta numeric;
BEGIN
  IF NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.pos_stock_adjustments
    WHERE product_id = NEW.id
      AND created_at > now() - interval '5 seconds'
  ) INTO recent_exists;

  IF recent_exists THEN
    RETURN NEW;
  END IF;

  delta := COALESCE(NEW.stock,0) - COALESCE(OLD.stock,0);

  INSERT INTO public.pos_stock_adjustments (
    store_id, product_id, sku, barcode, product_name,
    direction, quantity, previous_stock, new_stock,
    reason, movement_type
  ) VALUES (
    NEW.store_id, NEW.id, NEW.sku, NEW.barcode, COALESCE(NEW.name,'—'),
    CASE WHEN delta >= 0 THEN 'in' ELSE 'out' END,
    ABS(delta), OLD.stock, NEW.stock,
    'Ajuste direto sem classificação (blindagem automática)',
    'ajuste'
  );

  RETURN NEW;
END
$$;

-- Backfill: remove blindagem rows shadowing recent real sales
DELETE FROM public.pos_stock_adjustments b
WHERE b.reason = 'Ajuste direto sem classificação (blindagem automática)'
  AND b.created_at > now() - interval '60 days'
  AND EXISTS (
    SELECT 1 FROM public.pos_stock_adjustments s
    WHERE s.product_id = b.product_id
      AND s.sale_id IS NOT NULL
      AND s.sale_event = 'sale'
      AND s.direction = 'out'
      AND s.quantity = b.quantity
      AND s.created_at BETWEEN b.created_at - interval '10 seconds' AND b.created_at + interval '10 seconds'
  );

UPDATE public.pos_stock_adjustments
   SET movement_type = 'venda'
 WHERE reason = 'pos_sale' AND sale_event = 'sale' AND movement_type IS NULL;
