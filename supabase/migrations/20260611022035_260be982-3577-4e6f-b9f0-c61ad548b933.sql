CREATE OR REPLACE FUNCTION public.apply_pos_sale_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item record;
  v_adj record;
  v_product record;
  v_target_store uuid;
  v_cur_stock numeric;
  v_new_stock numeric;
  v_event text;
  v_direction text;
  v_reason text;
  v_adj_id uuid;
  v_payload jsonb;
  v_tiny_items jsonb := '[]'::jsonb;
  v_shopify_items jsonb := '[]'::jsonb;
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      v_event := 'sale'; v_direction := 'out'; v_reason := 'pos_sale';
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' AND COALESCE(OLD.status, '') <> 'completed' THEN
      v_event := 'sale'; v_direction := 'out'; v_reason := 'pos_sale';
    ELSIF NEW.status = 'cancelled' AND COALESCE(OLD.status, '') <> 'cancelled' THEN
      v_event := 'cancel'; v_direction := 'in'; v_reason := 'sale_cancelled';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  v_target_store := COALESCE(NEW.stock_source_store_id, NEW.store_id);

  -- ============ CANCELAMENTO / ESTORNO ============
  -- Devolve o estoque EXATAMENTE para a loja de onde a venda saiu.
  IF v_event = 'cancel' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pos_stock_adjustments
      WHERE sale_id = NEW.id AND sale_event = 'sale'
    ) THEN
      RETURN NEW;
    END IF;

    FOR v_adj IN
      SELECT id, store_id, product_id, tiny_id, sku, barcode, product_name, quantity
      FROM public.pos_stock_adjustments
      WHERE sale_id = NEW.id AND sale_event = 'sale'
    LOOP
      -- já estornado?
      IF EXISTS (
        SELECT 1 FROM public.pos_stock_adjustments
        WHERE sale_id = NEW.id AND product_id = v_adj.product_id AND sale_event = 'cancel'
      ) THEN
        CONTINUE;
      END IF;

      SELECT stock INTO v_cur_stock FROM public.pos_products WHERE id = v_adj.product_id;
      IF v_cur_stock IS NULL THEN
        CONTINUE;
      END IF;

      v_new_stock := COALESCE(v_cur_stock, 0) + v_adj.quantity;

      UPDATE public.pos_products
         SET stock = v_new_stock, updated_at = now()
       WHERE id = v_adj.product_id;

      INSERT INTO public.pos_stock_adjustments(
        store_id, product_id, tiny_id, sku, barcode, product_name,
        direction, quantity, previous_stock, new_stock, reason,
        seller_id, sale_id, sale_event, tiny_mirror_status
      ) VALUES (
        v_adj.store_id, v_adj.product_id, v_adj.tiny_id, v_adj.sku, v_adj.barcode,
        COALESCE(v_adj.product_name, ''),
        'in', v_adj.quantity, COALESCE(v_cur_stock, 0), v_new_stock, v_reason,
        NEW.seller_id, NEW.id, 'cancel',
        CASE WHEN v_adj.tiny_id IS NOT NULL THEN 'pending' ELSE NULL END
      ) RETURNING id INTO v_adj_id;

      IF v_adj.tiny_id IS NOT NULL THEN
        v_tiny_items := v_tiny_items || jsonb_build_object(
          'adjustment_id', v_adj_id,
          'product_id',    v_adj.product_id,
          'store_id',      v_adj.store_id,
          'tiny_id',       v_adj.tiny_id,
          'sku',           v_adj.sku,
          'new_stock',     v_new_stock,
          'quantity',      v_adj.quantity,
          'direction',     'in'
        );
      END IF;

      v_shopify_items := v_shopify_items || jsonb_build_object(
        'barcode', v_adj.barcode,
        'sku',     v_adj.sku
      );
    END LOOP;

  -- ============ VENDA (baixa com estoque compartilhado) ============
  ELSE
    FOR v_item IN
      SELECT sku, barcode, quantity, product_name
      FROM public.pos_sale_items
      WHERE sale_id = NEW.id
    LOOP
      IF COALESCE(v_item.quantity, 0) <= 0 THEN
        CONTINUE;
      END IF;

      -- idempotência por variação (barcode/sku) nesta venda
      IF EXISTS (
        SELECT 1 FROM public.pos_stock_adjustments
        WHERE sale_id = NEW.id AND sale_event = 'sale'
          AND (
            (v_item.barcode IS NOT NULL AND v_item.barcode <> '' AND barcode = v_item.barcode)
            OR (v_item.sku IS NOT NULL AND v_item.sku <> '' AND sku = v_item.sku)
          )
      ) THEN
        CONTINUE;
      END IF;

      v_product := NULL;

      -- 1) loja de origem da venda, se tiver saldo suficiente
      SELECT id, store_id, stock, sku, barcode, tiny_id INTO v_product
      FROM public.pos_products
      WHERE store_id = v_target_store
        AND (
          (v_item.barcode IS NOT NULL AND v_item.barcode <> '' AND barcode = v_item.barcode)
          OR (v_item.sku IS NOT NULL AND v_item.sku <> '' AND sku = v_item.sku)
        )
        AND COALESCE(stock, 0) >= v_item.quantity
      ORDER BY (CASE WHEN v_item.barcode IS NOT NULL AND barcode = v_item.barcode THEN 0 ELSE 1 END)
      LIMIT 1;

      -- 2) qualquer loja com saldo suficiente (maior saldo primeiro)
      IF v_product.id IS NULL THEN
        SELECT id, store_id, stock, sku, barcode, tiny_id INTO v_product
        FROM public.pos_products
        WHERE (
            (v_item.barcode IS NOT NULL AND v_item.barcode <> '' AND barcode = v_item.barcode)
            OR (v_item.sku IS NOT NULL AND v_item.sku <> '' AND sku = v_item.sku)
          )
          AND COALESCE(stock, 0) >= v_item.quantity
        ORDER BY COALESCE(stock, 0) DESC,
                 (CASE WHEN v_item.barcode IS NOT NULL AND barcode = v_item.barcode THEN 0 ELSE 1 END)
        LIMIT 1;
      END IF;

      -- 3) fallback: registro na loja de origem (permite negativo)
      IF v_product.id IS NULL THEN
        SELECT id, store_id, stock, sku, barcode, tiny_id INTO v_product
        FROM public.pos_products
        WHERE store_id = v_target_store
          AND (
            (v_item.barcode IS NOT NULL AND v_item.barcode <> '' AND barcode = v_item.barcode)
            OR (v_item.sku IS NOT NULL AND v_item.sku <> '' AND sku = v_item.sku)
          )
        ORDER BY (CASE WHEN v_item.barcode IS NOT NULL AND barcode = v_item.barcode THEN 0 ELSE 1 END)
        LIMIT 1;
      END IF;

      -- 4) fallback: qualquer loja com o produto (maior saldo primeiro)
      IF v_product.id IS NULL THEN
        SELECT id, store_id, stock, sku, barcode, tiny_id INTO v_product
        FROM public.pos_products
        WHERE (
            (v_item.barcode IS NOT NULL AND v_item.barcode <> '' AND barcode = v_item.barcode)
            OR (v_item.sku IS NOT NULL AND v_item.sku <> '' AND sku = v_item.sku)
          )
        ORDER BY COALESCE(stock, 0) DESC
        LIMIT 1;
      END IF;

      IF v_product.id IS NULL THEN
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
        'out', v_item.quantity, COALESCE(v_product.stock, 0), v_new_stock, v_reason,
        NEW.seller_id, NEW.id, 'sale',
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
  END IF;

  -- ============ PUSH ATIVO PARA O TINY (por loja) ============
  IF jsonb_array_length(v_tiny_items) > 0 THEN
    v_payload := jsonb_build_object(
      'sale_id',    NEW.id,
      'store_id',   v_target_store,
      'sale_event', v_event,
      'items',      v_tiny_items
    );

    PERFORM net.http_post(
      url     := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/tiny-mirror-stock',
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'apikey', v_anon_key,
                   'Authorization','Bearer '||v_anon_key
                 ),
      body    := v_payload
    );
  END IF;

  -- ============ PUSH ATIVO PARA A SHOPIFY (estoque compartilhado, set absoluto) ============
  IF jsonb_array_length(v_shopify_items) > 0 THEN
    v_payload := jsonb_build_object(
      'sale_id',    NEW.id,
      'sale_event', v_event,
      'items',      v_shopify_items
    );

    PERFORM net.http_post(
      url     := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/shopify-mirror-stock',
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'apikey', v_anon_key,
                   'Authorization','Bearer '||v_anon_key
                 ),
      body    := v_payload
    );
  END IF;

  RETURN NEW;
END;
$function$;