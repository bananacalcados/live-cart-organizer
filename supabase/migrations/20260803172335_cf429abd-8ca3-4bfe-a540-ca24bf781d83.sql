-- ============================================================
-- Ciclo de vida próprio para PRÊMIOS FÍSICOS da roleta
-- ============================================================

ALTER TABLE public.customer_prizes
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS forfeited_at timestamptz,
  ADD COLUMN IF NOT EXISTS forfeit_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_prizes_fulfillment_status_chk'
  ) THEN
    ALTER TABLE public.customer_prizes
      ADD CONSTRAINT customer_prizes_fulfillment_status_chk
      CHECK (fulfillment_status IN ('available','reserved','shipped','forfeited','expired'));
  END IF;
END $$;

UPDATE public.customer_prizes
   SET fulfillment_status = CASE
         WHEN is_redeemed THEN 'shipped'
         WHEN applied_order_id IS NOT NULL THEN 'reserved'
         WHEN expires_at <= now() THEN 'expired'
         ELSE 'available'
       END,
       reserved_at = COALESCE(reserved_at, CASE WHEN applied_order_id IS NOT NULL THEN updated_at END),
       shipped_at  = COALESCE(shipped_at, CASE WHEN is_redeemed THEN redeemed_at END)
 WHERE prize_type = 'product';

UPDATE public.customer_prizes
   SET fulfillment_status = CASE WHEN is_redeemed THEN 'shipped' ELSE fulfillment_status END
 WHERE prize_type <> 'product';

CREATE INDEX IF NOT EXISTS idx_customer_prizes_fulfillment
  ON public.customer_prizes (prize_type, fulfillment_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_prizes_physical_per_order
  ON public.customer_prizes (applied_order_id)
  WHERE prize_type = 'product' AND applied_order_id IS NOT NULL;

-- ============================================================
-- Vinculação (reserva)
-- ============================================================
CREATE OR REPLACE FUNCTION public.attach_physical_prize_to_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_phone  text;
  v_prize  public.customer_prizes%ROWTYPE;
  v_text   text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('attached', false, 'reason', 'order_not_found'); END IF;
  IF COALESCE(v_order.gift_description,'') ILIKE '%Prêmio roleta%' THEN
    RETURN jsonb_build_object('attached', false, 'reason', 'already_attached');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_prizes
     WHERE applied_order_id = p_order_id AND prize_type = 'product'
  ) THEN
    RETURN jsonb_build_object('attached', false, 'reason', 'order_already_has_prize');
  END IF;

  SELECT c.whatsapp INTO v_phone FROM public.customers c WHERE c.id = v_order.customer_id;
  IF COALESCE(v_phone,'') = '' THEN RETURN jsonb_build_object('attached', false, 'reason', 'no_phone'); END IF;

  SELECT * INTO v_prize
  FROM public.customer_prizes p
  WHERE p.prize_type = 'product'
    AND p.fulfillment_status = 'available'
    AND p.is_redeemed = false
    AND p.expires_at > now()
    AND p.applied_order_id IS NULL
    AND right(regexp_replace(p.customer_phone, '\D', '', 'g'), 8)
        = right(regexp_replace(v_phone, '\D', '', 'g'), 8)
  ORDER BY p.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN jsonb_build_object('attached', false, 'reason', 'no_physical_prize'); END IF;

  v_text := '🎡 Prêmio roleta: ' || v_prize.prize_label;
  IF COALESCE(v_order.gift_description,'') <> '' THEN
    v_text := v_order.gift_description || ' | ' || v_text;
  END IF;

  UPDATE public.orders
     SET has_gift = true, gift_description = v_text
   WHERE id = p_order_id;

  UPDATE public.customer_prizes
     SET applied_order_id = p_order_id,
         fulfillment_status = 'reserved',
         reserved_at = now(),
         updated_at = now()
   WHERE id = v_prize.id;

  RETURN jsonb_build_object('attached', true, 'prize_label', v_prize.prize_label);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_orders_attach_physical_prize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_prize public.customer_prizes%ROWTYPE;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gift_description,'') ILIKE '%Prêmio roleta%' THEN RETURN NEW; END IF;

  SELECT c.whatsapp INTO v_phone FROM public.customers c WHERE c.id = NEW.customer_id;
  IF COALESCE(v_phone,'') = '' THEN RETURN NEW; END IF;

  SELECT * INTO v_prize
  FROM public.customer_prizes p
  WHERE p.prize_type = 'product'
    AND p.fulfillment_status = 'available'
    AND p.is_redeemed = false
    AND p.expires_at > now()
    AND p.applied_order_id IS NULL
    AND right(regexp_replace(p.customer_phone, '\D', '', 'g'), 8)
        = right(regexp_replace(v_phone, '\D', '', 'g'), 8)
  ORDER BY p.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.has_gift := true;
  NEW.gift_description := CASE
    WHEN COALESCE(NEW.gift_description,'') <> ''
      THEN NEW.gift_description || ' | 🎡 Prêmio roleta: ' || v_prize.prize_label
    ELSE '🎡 Prêmio roleta: ' || v_prize.prize_label
  END;

  UPDATE public.customer_prizes
     SET applied_order_id = NEW.id,
         fulfillment_status = 'reserved',
         reserved_at = now(),
         updated_at = now()
   WHERE id = v_prize.id;

  RETURN NEW;
END;
$$;

-- ============================================================
-- ENVIADO (estado final)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_physical_prize_shipped(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int := 0;
BEGIN
  IF p_order_id IS NULL THEN RETURN jsonb_build_object('shipped', 0); END IF;

  UPDATE public.customer_prizes
     SET fulfillment_status = 'shipped',
         shipped_at = now(),
         is_redeemed = true,
         redeemed_at = COALESCE(redeemed_at, now()),
         updated_at = now()
   WHERE applied_order_id = p_order_id
     AND prize_type = 'product'
     AND fulfillment_status = 'reserved';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('shipped', v_count);
END;
$$;

-- ============================================================
-- PERDIDO (estado final — não volta para a área de membros)
-- ============================================================
CREATE OR REPLACE FUNCTION public.forfeit_physical_prize(p_order_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int := 0;
BEGIN
  IF p_order_id IS NULL THEN RETURN jsonb_build_object('forfeited', 0); END IF;

  UPDATE public.customer_prizes
     SET fulfillment_status = 'forfeited',
         forfeited_at = now(),
         forfeit_reason = COALESCE(NULLIF(p_reason,''), 'Pedido cancelado/estornado'),
         is_redeemed = true,
         redeemed_at = COALESCE(redeemed_at, now()),
         updated_at = now()
   WHERE applied_order_id = p_order_id
     AND prize_type = 'product'
     AND fulfillment_status = 'reserved';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('forfeited', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_physical_prize(p_prize_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prize public.customer_prizes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autorizado'; END IF;

  SELECT * INTO v_prize FROM public.customer_prizes WHERE id = p_prize_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_prize.prize_type <> 'product' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_physical'); END IF;

  UPDATE public.customer_prizes
     SET fulfillment_status = 'available',
         applied_order_id = NULL,
         reserved_at = NULL,
         shipped_at = NULL,
         forfeited_at = NULL,
         forfeit_reason = NULL,
         is_redeemed = false,
         redeemed_at = NULL,
         expires_at = GREATEST(expires_at, now() + interval '15 days'),
         notes = COALESCE(notes,'') || ' [Reaberto manualmente por ' || COALESCE(auth.uid()::text,'?')
                 || CASE WHEN COALESCE(p_reason,'') = '' THEN '' ELSE ': ' || p_reason END || ']',
         updated_at = now()
   WHERE id = p_prize_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================
-- Gatilho na expedição: concluído -> enviado / cancelado -> perdido
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_pos_sales_prize_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_order_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.status = 'cancelled' AND COALESCE(OLD.status,'') <> 'cancelled' THEN
    PERFORM public.forfeit_physical_prize(NEW.source_order_id, 'Pedido cancelado na expedição');
    RETURN NEW;
  END IF;

  IF NEW.expedition_stage = 'concluido'
     AND COALESCE(OLD.expedition_stage,'') <> 'concluido'
     AND COALESCE(NEW.status,'') <> 'cancelled' THEN
    PERFORM public.mark_physical_prize_shipped(NEW.source_order_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sales_prize_lifecycle ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_prize_lifecycle
AFTER UPDATE ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.trg_pos_sales_prize_lifecycle();

-- Cancelamento direto no pedido (stage 'nled')
CREATE OR REPLACE FUNCTION public.trg_orders_prize_forfeit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'nled' AND COALESCE(OLD.stage,'') <> 'nled' THEN
    PERFORM public.forfeit_physical_prize(NEW.id, 'Pedido cancelado');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_prize_forfeit ON public.orders;
CREATE TRIGGER trg_orders_prize_forfeit
AFTER UPDATE OF stage ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_orders_prize_forfeit();

-- ============================================================
-- Cancelamento pela expedição também derruba o prêmio
-- ============================================================
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

  IF v_sale.source_order_id IS NOT NULL THEN
    PERFORM public.forfeit_physical_prize(
      v_sale.source_order_id,
      COALESCE(NULLIF(p_reason,''), 'Pedido excluído da expedição')
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'restored_items', v_restored);
END;
$$;

REVOKE ALL ON FUNCTION public.expedition_cancel_sale(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.expedition_cancel_sale(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expedition_cancel_sale(uuid, text, boolean) TO service_role;

-- ============================================================
-- Consulta para as telas (status + histórico opcional)
-- ============================================================
DROP FUNCTION IF EXISTS public.get_customer_active_prizes(text);
CREATE OR REPLACE FUNCTION public.get_customer_active_prizes(
  p_phone text,
  p_include_history boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  prize_label text,
  prize_type text,
  prize_value numeric,
  coupon_code text,
  expires_at timestamptz,
  created_at timestamptz,
  is_redeemed boolean,
  redeemed_at timestamptz,
  applied_order_id uuid,
  fulfillment_status text,
  reserved_at timestamptz,
  shipped_at timestamptz,
  forfeited_at timestamptz,
  forfeit_reason text,
  days_left integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.prize_label, p.prize_type, p.prize_value, p.coupon_code,
         p.expires_at, p.created_at, p.is_redeemed, p.redeemed_at, p.applied_order_id,
         p.fulfillment_status, p.reserved_at, p.shipped_at, p.forfeited_at, p.forfeit_reason,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (p.expires_at - now())) / 86400))::int AS days_left
  FROM public.customer_prizes p
  WHERE COALESCE(p_phone,'') <> ''
    AND right(regexp_replace(p.customer_phone, '\D', '', 'g'), 8)
        = right(regexp_replace(p_phone, '\D', '', 'g'), 8)
    AND COALESCE(p.prize_type,'') <> 'none'
    AND (
      p_include_history
      OR (
        CASE
          WHEN p.prize_type = 'product' THEN
            p.fulfillment_status = 'reserved'
            OR (p.fulfillment_status = 'available' AND p.expires_at > now())
          ELSE p.is_redeemed = false AND p.expires_at > now()
        END
      )
    )
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_active_prizes(text, boolean) TO authenticated, service_role, anon;
REVOKE ALL ON FUNCTION public.reopen_physical_prize(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reopen_physical_prize(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_physical_prize_shipped(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forfeit_physical_prize(uuid, text) TO authenticated, service_role;