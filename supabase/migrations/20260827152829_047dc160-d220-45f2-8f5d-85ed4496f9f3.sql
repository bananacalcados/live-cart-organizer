
CREATE OR REPLACE FUNCTION public.pos_crediario_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT lower(unaccent(coalesce(p, '')))
$$;

CREATE OR REPLACE FUNCTION public.pos_crediario_search(
  p_store_id uuid,
  p_term text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  kind text,
  installment_id uuid,
  sale_id uuid,
  customer_name text,
  customer_phone text,
  customer_cpf text,
  code text,
  due_date date,
  installment_number integer,
  installments_total integer,
  amount numeric,
  paid_amount numeric,
  balance numeric,
  status text,
  gateway text,
  sale_created_at timestamptz,
  sale_total numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_term text := public.pos_crediario_norm(nullif(btrim(coalesce(p_term, '')), ''));
  v_digits text := regexp_replace(coalesce(p_term, ''), '\D', '', 'g');
BEGIN
  RETURN QUERY
  -- Parcelas (novo modelo)
  SELECT
    'installment'::text,
    i.id,
    i.sale_id,
    coalesce(i.customer_name, s.customer_name),
    coalesce(i.customer_phone, s.customer_phone),
    coalesce(i.customer_cpf, s.customer_cpf),
    i.code,
    i.due_date,
    i.installment_number,
    i.installments_total,
    i.amount,
    coalesce(i.paid_amount, 0),
    greatest(i.amount - coalesce(i.paid_amount, 0), 0),
    coalesce(i.status, 'pending'),
    i.gateway,
    s.created_at,
    s.total
  FROM public.pos_crediario_installments i
  LEFT JOIN public.pos_sales s ON s.id = i.sale_id
  WHERE (p_store_id IS NULL OR i.store_id = p_store_id)
    AND coalesce(i.status, 'pending') <> 'paid'
    AND (
      v_term IS NULL
      OR public.pos_crediario_norm(coalesce(i.customer_name, s.customer_name)) LIKE '%' || v_term || '%'
      OR public.pos_crediario_norm(i.code) LIKE '%' || v_term || '%'
      OR (length(v_digits) >= 3 AND regexp_replace(coalesce(i.customer_phone, s.customer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
      OR (length(v_digits) >= 3 AND regexp_replace(coalesce(i.customer_cpf, s.customer_cpf, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
    )

  UNION ALL

  -- Vendas antigas sem parcelas geradas
  SELECT
    'sale'::text,
    NULL::uuid,
    s.id,
    s.customer_name,
    s.customer_phone,
    s.customer_cpf,
    NULL::text,
    s.crediario_due_date::date,
    NULL::integer,
    NULL::integer,
    s.total,
    coalesce(s.crediario_paid_amount, 0),
    greatest(s.total - coalesce(s.crediario_paid_amount, 0), 0),
    coalesce(s.crediario_status, 'pending'),
    s.crediario_gateway,
    s.created_at,
    s.total
  FROM public.pos_sales s
  WHERE (p_store_id IS NULL OR s.store_id = p_store_id)
    AND public.pos_crediario_norm(s.payment_method) LIKE '%credi%'
    AND coalesce(s.crediario_status, 'pending') <> 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.pos_crediario_installments i2 WHERE i2.sale_id = s.id)
    AND (
      v_term IS NULL
      OR public.pos_crediario_norm(s.customer_name) LIKE '%' || v_term || '%'
      OR (length(v_digits) >= 3 AND regexp_replace(coalesce(s.customer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
      OR (length(v_digits) >= 3 AND regexp_replace(coalesce(s.customer_cpf, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
    )
  ORDER BY 8 NULLS LAST, 16 DESC
  LIMIT greatest(coalesce(p_limit, 100), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_crediario_search(uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.pos_crediario_search(uuid, text, integer) TO authenticated, service_role;

-- Baixa por parcela + atualização do resumo da venda
CREATE OR REPLACE FUNCTION public.pos_crediario_pay_installment(
  p_installment_id uuid,
  p_amount numeric,
  p_method text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_inst public.pos_crediario_installments%ROWTYPE;
  v_new_paid numeric;
  v_status text;
  v_sale_total numeric;
  v_sale_paid numeric;
  v_all_paid boolean;
BEGIN
  SELECT * INTO v_inst FROM public.pos_crediario_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parcela não encontrada';
  END IF;
  IF coalesce(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor inválido';
  END IF;

  v_new_paid := coalesce(v_inst.paid_amount, 0) + p_amount;
  v_status := CASE WHEN v_new_paid >= v_inst.amount - 0.005 THEN 'paid' ELSE 'partial' END;

  UPDATE public.pos_crediario_installments
  SET paid_amount = v_new_paid,
      status = v_status,
      paid_method = p_method,
      paid_at = CASE WHEN v_status = 'paid' THEN now() ELSE paid_at END,
      notes = coalesce(p_notes, notes),
      updated_at = now()
  WHERE id = p_installment_id;

  SELECT coalesce(sum(coalesce(paid_amount, 0)), 0),
         bool_and(coalesce(status, 'pending') = 'paid')
    INTO v_sale_paid, v_all_paid
  FROM public.pos_crediario_installments WHERE sale_id = v_inst.sale_id;

  SELECT total INTO v_sale_total FROM public.pos_sales WHERE id = v_inst.sale_id;

  UPDATE public.pos_sales
  SET crediario_paid_amount = v_sale_paid,
      crediario_status = CASE WHEN v_all_paid THEN 'paid' ELSE 'pending' END,
      crediario_paid_at = CASE WHEN v_all_paid THEN now() ELSE crediario_paid_at END,
      crediario_paid_method = p_method
  WHERE id = v_inst.sale_id;

  RETURN jsonb_build_object(
    'installment_id', p_installment_id,
    'sale_id', v_inst.sale_id,
    'installment_status', v_status,
    'sale_paid_amount', v_sale_paid,
    'sale_total', v_sale_total,
    'sale_fully_paid', v_all_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_crediario_pay_installment(uuid, numeric, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.pos_crediario_pay_installment(uuid, numeric, text, text) TO authenticated, service_role;

-- Baixa de venda antiga (sem parcelas)
CREATE OR REPLACE FUNCTION public.pos_crediario_pay_sale(
  p_sale_id uuid,
  p_amount numeric,
  p_method text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_total numeric;
  v_paid numeric;
BEGIN
  SELECT total, coalesce(crediario_paid_amount, 0) INTO v_total, v_paid
  FROM public.pos_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;

  v_paid := v_paid + p_amount;

  UPDATE public.pos_sales
  SET crediario_paid_amount = v_paid,
      crediario_paid_method = p_method,
      crediario_status = CASE WHEN v_paid >= v_total - 0.005 THEN 'paid' ELSE 'pending' END,
      crediario_paid_at = CASE WHEN v_paid >= v_total - 0.005 THEN now() ELSE crediario_paid_at END
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('sale_id', p_sale_id, 'sale_paid_amount', v_paid, 'sale_total', v_total,
                            'sale_fully_paid', v_paid >= v_total - 0.005);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_crediario_pay_sale(uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.pos_crediario_pay_sale(uuid, numeric, text) TO authenticated, service_role;
