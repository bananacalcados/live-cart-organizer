CREATE TABLE public.pos_crediario_installments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  store_id UUID,
  customer_id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  customer_cpf TEXT,
  installment_number INTEGER NOT NULL,
  installments_total INTEGER NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  paid_at TIMESTAMP WITH TIME ZONE,
  paid_method TEXT,
  gateway TEXT,
  code TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT pos_crediario_installments_unique_number UNIQUE (sale_id, installment_number),
  CONSTRAINT pos_crediario_installments_code_unique UNIQUE (code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_crediario_installments TO authenticated;
GRANT ALL ON public.pos_crediario_installments TO service_role;

ALTER TABLE public.pos_crediario_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage crediario installments"
ON public.pos_crediario_installments
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE INDEX idx_pos_cred_inst_sale ON public.pos_crediario_installments(sale_id);
CREATE INDEX idx_pos_cred_inst_store_status_due ON public.pos_crediario_installments(store_id, status, due_date);
CREATE INDEX idx_pos_cred_inst_due ON public.pos_crediario_installments(due_date);
CREATE INDEX idx_pos_cred_inst_customer ON public.pos_crediario_installments(customer_id);

CREATE TRIGGER trg_pos_cred_inst_updated_at
BEFORE UPDATE ON public.pos_crediario_installments
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

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
BEGIN
  SELECT id, store_id, customer_id, customer_name, customer_phone, customer_cpf,
         total, crediario_gateway, crediario_due_date
    INTO v_sale
  FROM public.pos_sales
  WHERE id = p_sale_id;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Venda % nao encontrada', p_sale_id;
  END IF;

  -- Idempotente: se ja existem parcelas, apenas retorna as existentes
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
  v_short := upper(replace(substring(p_sale_id::text from 1 for 4), '-', ''));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    v_idx := v_idx + 1;
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
      'CR-' || v_short || '-' || lpad(v_idx::text, 2, '0')
    );
  END LOOP;

  RETURN QUERY SELECT * FROM public.pos_crediario_installments
    WHERE sale_id = p_sale_id ORDER BY installment_number;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_crediario_installments(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_crediario_installments(UUID, JSONB, TEXT) TO authenticated, service_role;