CREATE OR REPLACE FUNCTION public.expedition_cancel_sale(
  p_sale_id uuid,
  p_reason text DEFAULT NULL,
  p_restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_target_store uuid;
  v_item record;
  v_codes text[];
  v_product record;
  v_new_stock numeric;
  v_restored int := 0;
BEGIN
  SELECT id, store_id, stock_source_store_id, seller_id, status, notes, source_order_id
    INTO v_sale
  FROM public.pos_sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;
  IF v_sale.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;

  v_target_store := COALESCE(v_sale.stock_source_store_id, v_sale.store_id);

  IF p_restore_stock THEN
    FOR v_item IN SELECT * FROM public.pos_sale_items WHERE sale_id = p_sale_id LOOP
      v_codes := ARRAY(SELECT DISTINCT unnest FROM unnest(ARRAY[v_item.barcode, v_item.sku])
                       WHERE unnest IS NOT NULL AND unnest <> '');
      IF array_length(v_codes,1) IS NULL THEN CONTINUE; END IF;

      SELECT p.id, p.store_id, p.stock, p.sku, p.barcode, p.tiny_id INTO v_product
      FROM public.pos_products p JOIN public.pos_stores s ON s.id = p.store_id
      WHERE s.is_simulation = false
        AND (p.barcode = ANY(v_codes) OR p.sku = ANY(v_codes))
      ORDER BY (CASE WHEN p.store_id = v_target_store THEN 0 ELSE 1 END), COALESCE(p.stock,0) DESC
      LIMIT 1;

      IF v_product.id IS NULL THEN CONTINUE; END IF;

      v_new_stock := COALESCE(v_product.stock,0) + v_item.quantity;
      UPDATE public.pos_products SET stock = v_new_stock, updated_at = now() WHERE id = v_product.id;
      INSERT INTO public.pos_stock_adjustments(
        store_id, product_id, tiny_id, sku, barcode, product_name,
        direction, quantity, previous_stock, new_stock, reason, seller_id, movement_type
      ) VALUES (
        v_product.store_id, v_product.id, v_product.tiny_id, v_product.sku, v_product.barcode,
        COALESCE(v_item.product_name,''), 'in', v_item.quantity,
        COALESCE(v_product.stock,0), v_new_stock,
        'expedicao_pedido_excluido', v_sale.seller_id, 'devolucao'
      );
      DELETE FROM public.pos_stock_adjustments
      WHERE sale_id = p_sale_id AND product_id = v_product.id AND sale_event = 'sale';
      v_restored := v_restored + 1;
    END LOOP;
  END IF;

  UPDATE public.pos_sales
     SET status = 'cancelled',
         status_cancelamento = 'cancelado',
         expedition_group_id = NULL,
         notes = COALESCE(notes,'') || CASE WHEN COALESCE(p_reason,'') = '' THEN ' [Excluído da expedição]'
                                            ELSE ' [Excluído da expedição: ' || p_reason || ']' END,
         updated_at = now()
   WHERE id = p_sale_id;

  RETURN jsonb_build_object('ok', true, 'restored_items', v_restored);
END;
$$;

REVOKE ALL ON FUNCTION public.expedition_cancel_sale(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.expedition_cancel_sale(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expedition_cancel_sale(uuid, text, boolean) TO service_role;