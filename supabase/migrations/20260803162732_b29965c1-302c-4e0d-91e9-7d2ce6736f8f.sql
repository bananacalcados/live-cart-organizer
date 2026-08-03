-- 1) Consulta de prêmios ativos por telefone (últimos 8 dígitos)
CREATE OR REPLACE FUNCTION public.get_customer_active_prizes(p_phone text)
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
  days_left integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.prize_label, p.prize_type, p.prize_value, p.coupon_code,
         p.expires_at, p.created_at, p.is_redeemed, p.redeemed_at, p.applied_order_id,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (p.expires_at - now())) / 86400))::int AS days_left
  FROM public.customer_prizes p
  WHERE COALESCE(p_phone,'') <> ''
    AND right(regexp_replace(p.customer_phone, '\D', '', 'g'), 8)
        = right(regexp_replace(p_phone, '\D', '', 'g'), 8)
    AND p.is_redeemed = false
    AND p.expires_at > now()
    AND COALESCE(p.prize_type,'') <> 'none'
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_active_prizes(text) TO authenticated, service_role, anon;

-- 2) Vincula prêmio FÍSICO (produto) ao pedido como brinde de expedição
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

  SELECT c.whatsapp INTO v_phone FROM public.customers c WHERE c.id = v_order.customer_id;
  IF COALESCE(v_phone,'') = '' THEN RETURN jsonb_build_object('attached', false, 'reason', 'no_phone'); END IF;

  SELECT * INTO v_prize
  FROM public.customer_prizes p
  WHERE p.prize_type = 'product'
    AND p.is_redeemed = false
    AND p.expires_at > now()
    AND p.applied_order_id IS NULL
    AND right(regexp_replace(p.customer_phone, '\D', '', 'g'), 8)
        = right(regexp_replace(v_phone, '\D', '', 'g'), 8)
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('attached', false, 'reason', 'no_physical_prize'); END IF;

  v_text := '🎡 Prêmio roleta: ' || v_prize.prize_label;
  IF COALESCE(v_order.gift_description,'') <> '' THEN
    v_text := v_order.gift_description || ' | ' || v_text;
  END IF;

  UPDATE public.orders
     SET has_gift = true, gift_description = v_text
   WHERE id = p_order_id;

  UPDATE public.customer_prizes
     SET applied_order_id = p_order_id, updated_at = now()
   WHERE id = v_prize.id;

  RETURN jsonb_build_object('attached', true, 'prize_label', v_prize.prize_label);
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_physical_prize_to_order(uuid) TO authenticated, service_role;

-- 3) Ao criar pedido novo, herda prêmio físico pendente (sem recursão: BEFORE INSERT em NEW)
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
    AND p.is_redeemed = false
    AND p.expires_at > now()
    AND p.applied_order_id IS NULL
    AND right(regexp_replace(p.customer_phone, '\D', '', 'g'), 8)
        = right(regexp_replace(v_phone, '\D', '', 'g'), 8)
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.has_gift := true;
  NEW.gift_description := CASE
    WHEN COALESCE(NEW.gift_description,'') <> ''
      THEN NEW.gift_description || ' | 🎡 Prêmio roleta: ' || v_prize.prize_label
    ELSE '🎡 Prêmio roleta: ' || v_prize.prize_label
  END;

  UPDATE public.customer_prizes
     SET applied_order_id = NEW.id, updated_at = now()
   WHERE id = v_prize.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_attach_physical_prize ON public.orders;
CREATE TRIGGER trg_orders_attach_physical_prize
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_orders_attach_physical_prize();