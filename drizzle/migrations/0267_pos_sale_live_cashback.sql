ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS cashback_id uuid, ADD COLUMN IF NOT EXISTS cashback_amount numeric NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_pos_sales_cashback_id ON public.pos_sales(cashback_id) WHERE cashback_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.available_cashbacks_for_phone(p_phone text)
RETURNS TABLE(id uuid, coupon_code text, cashback_amount numeric, min_purchase numeric, expires_at timestamptz, reserved_sale_id uuid, reserved_order_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, c.coupon_code, c.cashback_amount, COALESCE(c.min_purchase,0), c.expires_at,
    (SELECT s.id FROM pos_sales s WHERE s.cashback_id = c.id AND COALESCE(s.status,'') NOT IN ('cancelled','refunded') LIMIT 1),
    (SELECT o.id FROM orders o WHERE o.cashback_id = c.id AND o.stage <> 'cancelled' LIMIT 1)
  FROM internal_cashback c
  WHERE public.is_team_member(auth.uid())
    AND length(regexp_replace(coalesce(p_phone,''),'\D','','g')) >= 8
    AND right(regexp_replace(c.customer_phone,'\D','','g'),8) = right(regexp_replace(p_phone,'\D','','g'),8)
    AND c.is_used = false AND c.expires_at > now()
  ORDER BY c.cashback_amount DESC LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.available_cashbacks_for_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.available_cashbacks_for_phone(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_sale_cashback(p_sale_id uuid, p_cashback_id uuid)
RETURNS TABLE(cashback_id uuid, cashback_amount numeric, discount numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sale pos_sales%rowtype; c internal_cashback%rowtype; v_phone text; v_old numeric; v_ship numeric; v_base numeric; v_amt numeric; v_disc numeric; v_total numeric;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_team_member(auth.uid())) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT * INTO v_sale FROM pos_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF COALESCE(v_sale.status,'') IN ('paid','completed','pending_pickup','cancelled','refunded') THEN RAISE EXCEPTION 'Não é possível alterar o cashback de uma venda fechada'; END IF;
  IF EXISTS (SELECT 1 FROM payment_splits p WHERE p.sale_id = p_sale_id AND p.status NOT IN ('refunded','canceled','cancelled')) THEN
    RAISE EXCEPTION 'Remova o pagamento dividido antes de alterar o cashback';
  END IF;
  v_old := COALESCE(v_sale.cashback_amount,0);
  v_ship := CASE WHEN COALESCE(v_sale.payment_details->>'free_shipping','') = 'true' THEN 0
    ELSE COALESCE(v_sale.shipping_cost, nullif(v_sale.payment_details->>'shipping_amount','')::numeric, 0) END;

  IF p_cashback_id IS NULL THEN
    v_disc := greatest(0, COALESCE(v_sale.discount,0) - v_old);
    v_total := round(greatest(0, COALESCE(v_sale.total,0) + v_old), 2);
    UPDATE pos_sales SET cashback_id = NULL, cashback_amount = 0, discount = v_disc, total = v_total WHERE id = p_sale_id;
    RETURN QUERY SELECT NULL::uuid, 0::numeric, v_disc, v_total; RETURN;
  END IF;

  SELECT * INTO c FROM internal_cashback WHERE id = p_cashback_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cashback não encontrado'; END IF;
  IF c.is_used THEN RAISE EXCEPTION 'Cashback já utilizado'; END IF;
  IF c.expires_at <= now() THEN RAISE EXCEPTION 'Cashback expirado'; END IF;
  SELECT coalesce(nullif(v_sale.customer_phone,''), nullif(pc.whatsapp,'')) INTO v_phone FROM pos_customers pc WHERE pc.id = v_sale.customer_id;
  v_phone := coalesce(v_phone, v_sale.customer_phone);
  IF length(regexp_replace(coalesce(v_phone,''),'\D','','g')) < 8
     OR right(regexp_replace(coalesce(v_phone,''),'\D','','g'),8) <> right(regexp_replace(coalesce(c.customer_phone,''),'\D','','g'),8) THEN
    RAISE EXCEPTION 'Este cashback pertence a outro WhatsApp';
  END IF;
  IF EXISTS (SELECT 1 FROM orders o WHERE o.cashback_id = c.id AND o.stage <> 'cancelled')
     OR EXISTS (SELECT 1 FROM pos_sales s WHERE s.cashback_id = c.id AND s.id <> p_sale_id AND COALESCE(s.status,'') NOT IN ('cancelled','refunded')) THEN
    RAISE EXCEPTION 'Cashback já reservado em outro pedido';
  END IF;
  -- base de produtos já com os outros descontos (sem o cashback atual e sem frete)
  v_base := greatest(0, COALESCE(v_sale.total,0) + v_old - v_ship);
  IF v_base < COALESCE(c.min_purchase,0) THEN
    RAISE EXCEPTION 'Compra mínima de R$ % para este cashback', to_char(c.min_purchase,'FM999999990.00');
  END IF;
  v_amt := round(least(c.cashback_amount, v_base), 2);
  IF v_amt <= 0 THEN RAISE EXCEPTION 'Não há valor de produtos para abater'; END IF;
  v_disc := greatest(0, COALESCE(v_sale.discount,0) - v_old + v_amt);
  v_total := round(greatest(0, COALESCE(v_sale.total,0) + v_old - v_amt), 2);
  UPDATE pos_sales SET cashback_id = c.id, cashback_amount = v_amt, discount = v_disc, total = v_total WHERE id = p_sale_id;
  RETURN QUERY SELECT c.id, v_amt, v_disc, v_total;
END $$;
REVOKE ALL ON FUNCTION public.set_sale_cashback(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sale_cashback(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_pos_sales_recalc_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if NEW.voucher_id is not null
     and NEW.status in ('completed', 'paid', 'pending_pickup')
     and (TG_OP = 'INSERT' or coalesce(OLD.status, '') not in ('completed', 'paid', 'pending_pickup')) then
    update public.vouchers
       set status = 'usado', saldo = 0, used_at = coalesce(used_at, now()), used_sale_id = NEW.id, updated_at = now()
     where id = NEW.voucher_id and status = 'ativo';
  end if;
  if NEW.cashback_id is not null
     and NEW.status in ('completed', 'paid', 'pending_pickup')
     and (TG_OP = 'INSERT' or coalesce(OLD.status, '') not in ('completed', 'paid', 'pending_pickup')) then
    update public.internal_cashback
       set is_used = true, used_at = now(), used_channel = 'pos_whatsapp', used_external_ref = NEW.id::text, updated_at = now()
     where id = NEW.cashback_id and is_used = false;
  end if;
  if NEW.customer_unified_id is not null then
    perform public.recalc_customer_metrics(NEW.customer_unified_id);
  end if;
  if TG_OP = 'UPDATE' and OLD.customer_unified_id is not null and OLD.customer_unified_id is distinct from NEW.customer_unified_id then
    perform public.recalc_customer_metrics(OLD.customer_unified_id);
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.available_cashbacks_for_order(p_phone text, p_order_id uuid)
RETURNS TABLE(id uuid, coupon_code text, cashback_amount numeric, min_purchase numeric, expires_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, c.coupon_code, c.cashback_amount, COALESCE(c.min_purchase,0), c.expires_at, c.created_at
  FROM internal_cashback c
  WHERE auth.uid() IS NOT NULL
    AND length(regexp_replace(coalesce(p_phone,''),'\D','','g')) >= 8
    AND right(regexp_replace(c.customer_phone,'\D','','g'),8) = right(regexp_replace(p_phone,'\D','','g'),8)
    AND c.is_used = false AND c.expires_at > now()
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.cashback_id = c.id AND o.id <> p_order_id AND o.stage <> 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM pos_sales s WHERE s.cashback_id = c.id AND COALESCE(s.status,'') NOT IN ('cancelled','refunded'))
  ORDER BY c.cashback_amount DESC;
$$;