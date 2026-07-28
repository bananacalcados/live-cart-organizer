CREATE OR REPLACE FUNCTION public.expedition_update_sale_items(
  p_sale_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_target_store uuid;
  v_item jsonb;
  v_existing record;
  v_delta numeric;
  v_product record;
  v_codes text[];
  v_new_stock numeric;
  v_keep uuid[] := '{}';
  v_subtotal numeric := 0;
  v_total numeric;
BEGIN
  SELECT id, store_id, stock_source_store_id, seller_id, discount, shipping_cost, status
    INTO v_sale
  FROM public.pos_sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;

  v_target_store := COALESCE(v_sale.stock_source_store_id, v_sale.store_id);

  -- 1) Atualiza/insere itens enviados
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 THEN CONTINUE; END IF;

    v_existing := NULL;
    IF NULLIF(v_item->>'id','') IS NOT NULL THEN
      SELECT * INTO v_existing FROM public.pos_sale_items
      WHERE id = (v_item->>'id')::uuid AND sale_id = p_sale_id;
    END IF;

    IF v_existing.id IS NOT NULL THEN
      v_delta := (v_item->>'quantity')::numeric - v_existing.quantity;
      UPDATE public.pos_sale_items
         SET quantity = (v_item->>'quantity')::int,
             unit_price = COALESCE((v_item->>'unit_price')::numeric, unit_price),
             total_price = COALESCE((v_item->>'unit_price')::numeric, unit_price) * (v_item->>'quantity')::int
       WHERE id = v_existing.id;
      v_keep := v_keep || v_existing.id;

      IF v_delta <> 0 THEN
        v_codes := ARRAY(SELECT DISTINCT unnest FROM unnest(ARRAY[v_existing.barcode, v_existing.sku])
                         WHERE unnest IS NOT NULL AND unnest <> '');
        IF array_length(v_codes,1) IS NOT NULL THEN
          SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
          FROM public.pos_products p JOIN public.pos_stores s ON s.id = p.store_id
          WHERE s.is_simulation = false
            AND (p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes))
          ORDER BY (CASE WHEN p.store_id = v_target_store THEN 0 ELSE 1 END), COALESCE(p.stock,0) DESC
          LIMIT 1;

          IF v_product.id IS NOT NULL THEN
            v_new_stock := GREATEST(COALESCE(v_product.stock,0) - v_delta, 0);
            UPDATE public.pos_products SET stock = v_new_stock, updated_at = now() WHERE id = v_product.id;
            INSERT INTO public.pos_stock_adjustments(
              store_id, product_id, tiny_id, sku, barcode, product_name,
              direction, quantity, previous_stock, new_stock, reason, seller_id, movement_type
            ) VALUES (
              v_product.store_id, v_product.id, v_product.tiny_id, v_product.sku, v_product.barcode,
              COALESCE(v_existing.product_name,''),
              CASE WHEN v_delta > 0 THEN 'out' ELSE 'in' END, ABS(v_delta),
              COALESCE(v_product.stock,0), v_new_stock,
              'expedicao_edicao_itens', v_sale.seller_id,
              CASE WHEN v_delta > 0 THEN 'venda' ELSE 'devolucao' END
            );
          END IF;
        END IF;
      END IF;
    ELSE
      -- novo item: o gatilho trg_pos_sale_items_stock_movement faz a baixa
      INSERT INTO public.pos_sale_items(
        sale_id, sku, barcode, product_name, variant_name, size, quantity, unit_price, total_price
      ) VALUES (
        p_sale_id,
        NULLIF(v_item->>'sku',''),
        NULLIF(v_item->>'barcode',''),
        COALESCE(NULLIF(v_item->>'product_name',''), 'Produto'),
        NULLIF(v_item->>'variant_name',''),
        NULLIF(v_item->>'size',''),
        (v_item->>'quantity')::int,
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE((v_item->>'unit_price')::numeric, 0) * (v_item->>'quantity')::int
      );
    END IF;
  END LOOP;

  -- 2) Remove itens que sumiram da lista, devolvendo estoque
  FOR v_existing IN
    SELECT * FROM public.pos_sale_items
    WHERE sale_id = p_sale_id AND NOT (id = ANY(v_keep))
      AND created_at < now() - interval '1 millisecond'
  LOOP
    v_codes := ARRAY(SELECT DISTINCT unnest FROM unnest(ARRAY[v_existing.barcode, v_existing.sku])
                     WHERE unnest IS NOT NULL AND unnest <> '');
    IF array_length(v_codes,1) IS NOT NULL THEN
      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p JOIN public.pos_stores s ON s.id = p.store_id
      WHERE s.is_simulation = false
        AND (p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes))
      ORDER BY (CASE WHEN p.store_id = v_target_store THEN 0 ELSE 1 END), COALESCE(p.stock,0) DESC
      LIMIT 1;

      IF v_product.id IS NOT NULL THEN
        v_new_stock := COALESCE(v_product.stock,0) + v_existing.quantity;
        UPDATE public.pos_products SET stock = v_new_stock, updated_at = now() WHERE id = v_product.id;
        INSERT INTO public.pos_stock_adjustments(
          store_id, product_id, tiny_id, sku, barcode, product_name,
          direction, quantity, previous_stock, new_stock, reason, seller_id, movement_type
        ) VALUES (
          v_product.store_id, v_product.id, v_product.tiny_id, v_product.sku, v_product.barcode,
          COALESCE(v_existing.product_name,''),
          'in', v_existing.quantity, COALESCE(v_product.stock,0), v_new_stock,
          'expedicao_item_removido', v_sale.seller_id, 'devolucao'
        );
        -- libera a trava de idempotência para permitir re-adicionar o mesmo produto depois
        DELETE FROM public.pos_stock_adjustments
        WHERE sale_id = p_sale_id AND product_id = v_product.id AND sale_event = 'sale';
      END IF;
    END IF;

    DELETE FROM public.pos_sale_items WHERE id = v_existing.id;
  END LOOP;

  -- 3) Recalcula totais
  SELECT COALESCE(SUM(total_price),0) INTO v_subtotal FROM public.pos_sale_items WHERE sale_id = p_sale_id;
  v_total := GREATEST(v_subtotal - COALESCE(v_sale.discount,0), 0) + COALESCE(v_sale.shipping_cost,0);
  UPDATE public.pos_sales SET subtotal = v_subtotal, total = v_total, updated_at = now() WHERE id = p_sale_id;

  RETURN jsonb_build_object('ok', true, 'subtotal', v_subtotal, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.expedition_update_sale_items(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.expedition_update_sale_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expedition_update_sale_items(uuid, jsonb) TO service_role;