CREATE OR REPLACE FUNCTION public.generate_crediario_installments(
  p_sale_id UUID,
  p_installments JSONB DEFAULT NULL,
  p_gateway TEXT DEFAULT NULL
)
RETURNS SETOF public.pos_crediario_installments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_total INTEGER;
  v_item JSONB;
  v_idx INTEGER := 0;
  v_short TEXT;
  v_code TEXT;
  v_try INTEGER;
BEGIN
  SELECT id, store_id, customer_id, customer_name, customer_phone, customer_cpf,
         total, crediario_gateway, crediario_due_date
    INTO v_sale
  FROM public.pos_sales
  WHERE id = p_sale_id;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Venda % nao encontrada', p_sale_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pos_crediario_installments WHERE sale_id = p_sale_id) THEN
    RETURN QUERY SELECT * FROM public.pos_crediario_installments
      WHERE sale_id = p_sale_id ORDER BY installment_number;
    RETURN;
  END IF;

  IF p_installments IS NULL OR jsonb_array_length(p_installments) = 0 THEN
    p_installments := jsonb_build_array(
      jsonb_build_object(
        'amount', COALESCE(v_sale.total, 0),
        'due_date', COALESCE(v_sale.crediario_due_date, (CURRENT_DATE + 30))
      )
    );
  END IF;

  v_total := jsonb_array_length(p_installments);
  v_short := upper(substring(md5(p_sale_id::text) from 1 for 6));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    v_idx := v_idx + 1;
    v_try := 0;
    LOOP
      v_code := 'CR-' || v_short || '-' || lpad(v_idx::text, 2, '0');
      IF v_try > 0 THEN
        v_code := v_code || '-' || upper(substring(md5(random()::text) from 1 for 3));
      END IF;
      BEGIN
        INSERT INTO public.pos_crediario_installments (
          sale_id, store_id, customer_id, customer_name, customer_phone, customer_cpf,
          installment_number, installments_total, amount, due_date, gateway, code
        ) VALUES (
          p_sale_id, v_sale.store_id, v_sale.customer_id, v_sale.customer_name,
          v_sale.customer_phone, v_sale.customer_cpf,
          v_idx, v_total,
          COALESCE((v_item->>'amount')::numeric, 0),
          COALESCE((v_item->>'due_date')::date, CURRENT_DATE + (30 * v_idx)),
          COALESCE(p_gateway, v_sale.crediario_gateway),
          v_code
        );
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_try := v_try + 1;
        IF v_try > 5 THEN
          RAISE;
        END IF;
      END;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT * FROM public.pos_crediario_installments
    WHERE sale_id = p_sale_id ORDER BY installment_number;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_crediario_installments(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_crediario_installments(UUID, JSONB, TEXT) TO authenticated, service_role;