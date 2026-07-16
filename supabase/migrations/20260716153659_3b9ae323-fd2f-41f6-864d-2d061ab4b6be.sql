CREATE OR REPLACE FUNCTION public.process_pos_sale_sale_event(p_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sale record;
  v_item record;
  v_product record;
  v_target_store uuid;
  v_target_is_sim boolean;
  v_new_stock numeric;
  v_adj_id uuid;
  v_payload jsonb;
  v_tiny_items jsonb := '[]'::jsonb;
  v_shopify_items jsonb := '[]'::jsonb;
  v_codes text[];
  v_alias_skus text[];
  v_alias_tiny bigint[];
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
BEGIN
  SELECT id, status, store_id, stock_source_store_id, seller_id, external_source
    INTO v_sale
  FROM public.pos_sales
  WHERE id = p_sale_id;

  IF v_sale.id IS NULL OR v_sale.status NOT IN ('completed', 'paid', 'conditional') THEN
    RETURN;
  END IF;

  v_target_store := COALESCE(v_sale.stock_source_store_id, v_sale.store_id);

  -- Se a loja alvo for uma SIMULAÇÃO (Gestão > Formação de Margem), ignora — busca só em lojas reais.
  SELECT COALESCE(is_simulation, false) INTO v_target_is_sim
  FROM public.pos_stores WHERE id = v_target_store;

  FOR v_item IN
    SELECT sku, barcode, quantity, product_name, variant_name
    FROM public.pos_sale_items
    WHERE sale_id = p_sale_id
  LOOP
    IF COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    v_codes := ARRAY(
      SELECT DISTINCT c FROM unnest(ARRAY[NULLIF(v_item.barcode, ''), NULLIF(v_item.sku, '')]) AS c
      WHERE c IS NOT NULL
    );

    IF array_length(v_codes, 1) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      ARRAY(SELECT DISTINCT product_sku FROM public.inventory_barcode_aliases
            WHERE original_barcode = ANY(v_codes) AND product_sku IS NOT NULL),
      ARRAY(SELECT DISTINCT product_tiny_id FROM public.inventory_barcode_aliases
            WHERE original_barcode = ANY(v_codes) AND product_tiny_id IS NOT NULL)
    INTO v_alias_skus, v_alias_tiny;

    IF EXISTS (
      SELECT 1 FROM public.pos_stock_adjustments
      WHERE sale_id = p_sale_id AND sale_event = 'sale'
        AND (
          barcode = ANY(v_codes)
          OR sku = ANY(v_codes)
          OR (v_alias_skus IS NOT NULL AND sku = ANY(v_alias_skus))
          OR (v_alias_tiny IS NOT NULL AND tiny_id = ANY(v_alias_tiny))
        )
    ) THEN
      CONTINUE;
    END IF;

    v_product := NULL;

    -- 1) loja alvo real com estoque suficiente
    IF NOT v_target_is_sim THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p
      JOIN public.pos_stores s ON s.id = p.store_id
      WHERE p.store_id = v_target_store
        AND s.is_simulation = false
        AND (
          p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes)
          OR (v_alias_skus IS NOT NULL AND p.sku = ANY(v_alias_skus))
          OR (v_alias_tiny IS NOT NULL AND p.tiny_id = ANY(v_alias_tiny))
        )
        AND COALESCE(p.stock, 0) >= v_item.quantity
      ORDER BY (CASE WHEN p.barcode = ANY(v_codes) THEN 0 ELSE 1 END)
      LIMIT 1;
    END IF;

    -- 2) qualquer loja REAL com estoque suficiente
    IF v_product.id IS NULL THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p
      JOIN public.pos_stores s ON s.id = p.store_id
      WHERE s.is_simulation = false
        AND (
          p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes)
          OR (v_alias_skus IS NOT NULL AND p.sku = ANY(v_alias_skus))
          OR (v_alias_tiny IS NOT NULL AND p.tiny_id = ANY(v_alias_tiny))
        )
        AND COALESCE(p.stock, 0) >= v_item.quantity
      ORDER BY COALESCE(p.stock, 0) DESC, (CASE WHEN p.barcode = ANY(v_codes) THEN 0 ELSE 1 END)
      LIMIT 1;
    END IF;

    -- 3) loja alvo real (sem exigir estoque)
    IF v_product.id IS NULL AND NOT v_target_is_sim THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p
      JOIN public.pos_stores s ON s.id = p.store_id
      WHERE p.store_id = v_target_store
        AND s.is_simulation = false
        AND (
          p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes)
          OR (v_alias_skus IS NOT NULL AND p.sku = ANY(v_alias_skus))
          OR (v_alias_tiny IS NOT NULL AND p.tiny_id = ANY(v_alias_tiny))
        )
      ORDER BY (CASE WHEN p.barcode = ANY(v_codes) THEN 0 ELSE 1 END)
      LIMIT 1;
    END IF;

    -- 4) qualquer loja REAL (fallback final; nunca simulação)
    IF v_product.id IS NULL THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p
      JOIN public.pos_stores s ON s.id = p.store_id
      WHERE s.is_simulation = false
        AND (
          p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes)
          OR (v_alias_skus IS NOT NULL AND p.sku = ANY(v_alias_skus))
          OR (v_alias_tiny IS NOT NULL AND p.tiny_id = ANY(v_alias_tiny))
        )
      ORDER BY COALESCE(p.stock, 0) DESC
      LIMIT 1;
    END IF;

    IF v_product.id IS NULL THEN
      INSERT INTO public.inventory_sale_unmatched_items(
        sale_id, item_code, product_name, variant_name, quantity, store_id, external_source
      ) VALUES (
        p_sale_id, COALESCE(v_codes[1], ''), COALESCE(v_item.product_name, ''),
        v_item.variant_name, v_item.quantity, v_target_store, v_sale.external_source
      )
      ON CONFLICT (sale_id, item_code) DO NOTHING;
      CONTINUE;
    END IF;

    v_new_stock := COALESCE(v_product.stock, 0) - v_item.quantity;

    UPDATE public.pos_products
       SET stock = v_new_stock, updated_at = now()
     WHERE id = v_product.id;

    INSERT INTO public.pos_stock_adjustments(
      store_id, product_id, tiny_id, sku, barcode, product_name,
      direction, quantity, previous_stock, new_stock, reason,
      seller_id, sale_id, sale_event, tiny_mirror_status
    ) VALUES (
      v_product.store_id, v_product.id, v_product.tiny_id, v_product.sku, v_product.barcode,
      COALESCE(v_item.product_name, ''),
      'out', v_item.quantity, COALESCE(v_product.stock, 0), v_new_stock, 'pos_sale',
      v_sale.seller_id, p_sale_id, 'sale',
      CASE WHEN v_product.tiny_id IS NOT NULL THEN 'pending' ELSE NULL END
    ) RETURNING id INTO v_adj_id;

    IF v_product.tiny_id IS NOT NULL THEN
      v_tiny_items := v_tiny_items || jsonb_build_object(
        'adjustment_id', v_adj_id,
        'product_id',    v_product.id,
        'store_id',      v_product.store_id,
        'tiny_id',       v_product.tiny_id,
        'sku',           v_product.sku,
        'new_stock',     v_new_stock,
        'quantity',      v_item.quantity,
        'direction',     'out'
      );
    END IF;

    v_shopify_items := v_shopify_items || jsonb_build_object(
      'barcode', v_product.barcode,
      'sku',     v_product.sku
    );
  END LOOP;

  IF jsonb_array_length(v_tiny_items) > 0 THEN
    v_payload := jsonb_build_object(
      'sale_id', p_sale_id, 'store_id', v_target_store, 'sale_event', 'sale', 'items', v_tiny_items
    );
    PERFORM net.http_post(
      url     := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/tiny-mirror-stock',
      headers := jsonb_build_object('Content-Type','application/json','apikey', v_anon_key,'Authorization','Bearer '||v_anon_key),
      body    := v_payload
    );
  END IF;

  IF jsonb_array_length(v_shopify_items) > 0 THEN
    v_payload := jsonb_build_object(
      'sale_id', p_sale_id, 'sale_event', 'sale', 'items', v_shopify_items
    );
    PERFORM net.http_post(
      url     := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/shopify-mirror-stock',
      headers := jsonb_build_object('Content-Type','application/json','apikey', v_anon_key,'Authorization','Bearer '||v_anon_key),
      body    := v_payload
    );
  END IF;
END;
$function$;