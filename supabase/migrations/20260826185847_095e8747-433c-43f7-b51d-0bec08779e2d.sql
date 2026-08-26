CREATE OR REPLACE FUNCTION public.chargeback_gate(
  p_phone text DEFAULT NULL,
  p_cpf text DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_pos_sale_id uuid DEFAULT NULL,
  p_customer_unified_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_cpf text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  v_suffix text;
  v_row record;
BEGIN
  -- Completa telefone/CPF a partir do pedido (orders -> customers)
  IF p_order_id IS NOT NULL THEN
    SELECT regexp_replace(COALESCE(NULLIF(v_phone, ''), c.whatsapp, ''), '\D', '', 'g'),
           regexp_replace(COALESCE(NULLIF(v_cpf, ''), c.cpf, ''), '\D', '', 'g')
      INTO v_phone, v_cpf
      FROM public.orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE o.id = p_order_id;
  END IF;

  -- Completa a partir da venda do PDV
  IF p_pos_sale_id IS NOT NULL AND (v_phone = '' OR v_cpf = '') THEN
    SELECT regexp_replace(COALESCE(NULLIF(v_phone, ''), s.customer_phone, pc.whatsapp, ''), '\D', '', 'g'),
           regexp_replace(COALESCE(NULLIF(v_cpf, ''), pc.cpf, ''), '\D', '', 'g')
      INTO v_phone, v_cpf
      FROM public.pos_sales s
      LEFT JOIN public.pos_customers pc ON pc.id = s.customer_id
     WHERE s.id = p_pos_sale_id;
  END IF;

  v_phone := COALESCE(v_phone, '');
  v_cpf := COALESCE(v_cpf, '');
  IF length(v_phone) >= 8 THEN
    v_suffix := right(v_phone, 8);
  END IF;
  IF length(v_cpf) <> 11 THEN
    v_cpf := '';
  END IF;

  IF v_suffix IS NULL AND v_cpf = '' AND p_customer_unified_id IS NULL THEN
    RETURN jsonb_build_object('blocked', false, 'reason', null);
  END IF;

  SELECT cb.id, cb.customer_name, cb.reason, cb.status, cb.amount,
         cb.source_order_name, cb.chargeback_date, cb.pos_sale_id, cb.order_id
    INTO v_row
    FROM public.chargebacks cb
   WHERE cb.blocked = true
     AND cb.status NOT IN ('resolved', 'dismissed')
     AND (
       (v_suffix IS NOT NULL AND cb.phone_key IS NOT NULL AND right(regexp_replace(cb.phone_key, '\D', '', 'g'), 8) = v_suffix)
       OR (v_cpf <> '' AND cb.cpf_digits = v_cpf)
       OR (p_customer_unified_id IS NOT NULL AND cb.customer_unified_id = p_customer_unified_id)
     )
   ORDER BY cb.created_at DESC
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('blocked', false, 'reason', null);
  END IF;

  RETURN jsonb_build_object(
    'blocked', true,
    'chargeback_id', v_row.id,
    'customer_name', v_row.customer_name,
    'reason', v_row.reason,
    'status', v_row.status,
    'amount', v_row.amount,
    'order_name', v_row.source_order_name,
    'chargeback_date', v_row.chargeback_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.chargeback_gate(text, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chargeback_gate(text, text, uuid, uuid, uuid) TO authenticated, service_role;