
-- 1) Estender payment_method_fees
ALTER TABLE public.payment_method_fees
  ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'mp_checkout',
  ADD COLUMN IF NOT EXISTS receipt_schedule text NOT NULL DEFAULT 'D0',
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.payment_method_fees DROP CONSTRAINT IF EXISTS payment_method_fees_acquirer_method_brand_installments_key;
ALTER TABLE public.payment_method_fees
  ADD CONSTRAINT payment_method_fees_unique
  UNIQUE (acquirer, product, method, brand, installments, receipt_schedule);

-- 2) Categorias financeiras base
INSERT INTO public.financial_categories (name, type, is_custom) VALUES
  ('Vendas PDV', 'income', true),
  ('Taxas de Cartão', 'expense', true),
  ('Sangria', 'expense', true),
  ('Suprimento', 'income', true)
ON CONFLICT DO NOTHING;

WITH parent AS (SELECT id FROM public.financial_categories WHERE name='Taxas de Cartão' AND parent_id IS NULL LIMIT 1)
INSERT INTO public.financial_categories (name, type, parent_id, is_custom)
SELECT 'Mercado Pago', 'expense', parent.id, true FROM parent
ON CONFLICT DO NOTHING;

-- 3) Seed taxas MP Checkout Transparente D0
INSERT INTO public.payment_method_fees (acquirer, product, method, brand, installments, fee_pct, fixed_fee, days_to_receive, receipt_schedule, notes) VALUES
  ('mercadopago','mp_checkout','credit',NULL,1,2.99,0,0,'D0','Checkout Transparente'),
  ('mercadopago','mp_checkout','credit',NULL,2,5.26,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,3,5.84,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,4,6.46,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,5,7.05,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,6,7.63,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,7,7.77,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,8,8.39,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,9,9.01,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,10,9.46,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,11,10.08,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','credit',NULL,12,10.71,0,0,'D0',NULL),
  ('mercadopago','mp_checkout','pix',NULL,1,0.60,0,0,'instant',NULL),
  ('mercadopago','mp_checkout','boleto',NULL,1,0,3.00,3,'D+3',NULL)
ON CONFLICT (acquirer, product, method, brand, installments, receipt_schedule) DO NOTHING;

-- 4) Seed taxas MP Point + Link de Pagamento
INSERT INTO public.payment_method_fees (acquirer, product, method, brand, installments, fee_pct, fixed_fee, days_to_receive, receipt_schedule, notes) VALUES
  ('mercadopago','mp_point','debit',NULL,1,0.99,0,0,'instant','Maquininha Point'),
  ('mercadopago','mp_point','credit',NULL,1,3.05,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,2,4.25,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,3,5.10,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,4,5.95,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,5,6.80,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,6,7.65,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,7,8.10,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,8,8.95,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,9,9.80,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,10,10.65,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,11,11.50,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,12,12.35,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,13,14.71,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,14,15.56,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,15,16.41,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,16,17.26,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,17,18.11,0,0,'instant',NULL),
  ('mercadopago','mp_point','credit',NULL,18,18.96,0,0,'instant',NULL),
  ('mercadopago','mp_point','pix',NULL,1,0.49,0,0,'instant',NULL)
ON CONFLICT (acquirer, product, method, brand, installments, receipt_schedule) DO NOTHING;

-- 5) Função utilitária: resolve a taxa aplicável
CREATE OR REPLACE FUNCTION public.resolve_payment_fee(
  p_acquirer text,
  p_product text,
  p_method text,
  p_installments int
) RETURNS public.payment_method_fees
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.payment_method_fees
  WHERE active = true
    AND acquirer = COALESCE(p_acquirer,'mercadopago')
    AND product = COALESCE(p_product,'mp_checkout')
    AND method = p_method
    AND installments = COALESCE(p_installments,1)
  ORDER BY (brand IS NULL) ASC
  LIMIT 1;
$$;

-- 6) Trigger pos_sales → cash_flow_entries
CREATE OR REPLACE FUNCTION public.trg_pos_sales_to_cash_flow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paid_statuses text[] := ARRAY['completed','paid','pending_sync','pending_pickup'];
  v_method text;
  v_installments int;
  v_product text;
  v_acquirer text;
  v_fee public.payment_method_fees%ROWTYPE;
  v_fee_amount numeric;
  v_income_cat uuid;
  v_fee_cat uuid;
  v_entry_date date;
BEGIN
  -- Só processa transições para "pago"
  IF NEW.status = ANY(v_paid_statuses)
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    v_method := LOWER(COALESCE(NEW.payment_method, 'unknown'));
    v_installments := COALESCE((NEW.payment_details->>'installments')::int, 1);
    v_acquirer := CASE
      WHEN NEW.payment_gateway IS NOT NULL THEN LOWER(NEW.payment_gateway)
      WHEN NEW.mercadopago_payment_id IS NOT NULL THEN 'mercadopago'
      ELSE 'mercadopago'
    END;
    -- Heurística produto: online → mp_checkout; físico → mp_point
    v_product := CASE
      WHEN NEW.sale_type IN ('online','tiny_online') THEN 'mp_checkout'
      ELSE 'mp_point'
    END;
    v_entry_date := COALESCE(NEW.paid_at::date, NEW.created_at::date);

    SELECT id INTO v_income_cat FROM public.financial_categories
      WHERE name='Vendas PDV' AND parent_id IS NULL LIMIT 1;
    SELECT c.id INTO v_fee_cat FROM public.financial_categories c
      JOIN public.financial_categories p ON p.id=c.parent_id
      WHERE c.name='Mercado Pago' AND p.name='Taxas de Cartão' LIMIT 1;

    -- Entrada (receita bruta)
    INSERT INTO public.cash_flow_entries (
      store_id, entry_date, direction, amount, category_id, payment_method,
      description, source, external_source, external_id, source_ref_id, pos_sale_id, status, confidence
    ) VALUES (
      NEW.store_id, v_entry_date, 'in', NEW.total, v_income_cat, v_method,
      'Venda PDV #' || COALESCE(NEW.invoice_number, NEW.id::text),
      'pos_sale', 'pos_sale', NEW.id::text, NEW.id::text, NEW.id, 'confirmed', 1.0
    ) ON CONFLICT (external_source, external_id) DO NOTHING;

    -- Taxa (saída), se cartão/pix
    IF v_method IN ('credit','debit','pix','credit_card','debit_card') THEN
      v_fee := public.resolve_payment_fee(v_acquirer, v_product,
        CASE WHEN v_method LIKE 'credit%' THEN 'credit'
             WHEN v_method LIKE 'debit%' THEN 'debit'
             ELSE v_method END,
        v_installments);
      IF v_fee.id IS NOT NULL THEN
        v_fee_amount := ROUND(NEW.total * v_fee.fee_pct / 100 + v_fee.fixed_fee, 2);
        IF v_fee_amount > 0 THEN
          INSERT INTO public.cash_flow_entries (
            store_id, entry_date, direction, amount, category_id, payment_method,
            description, source, external_source, external_id, source_ref_id, pos_sale_id, status, confidence, metadata
          ) VALUES (
            NEW.store_id, v_entry_date, 'out', v_fee_amount, v_fee_cat, v_method,
            'Taxa ' || v_acquirer || ' ' || v_method || ' ' || v_installments || 'x — Venda ' || COALESCE(NEW.invoice_number, NEW.id::text),
            'auto_fee', 'pos_sale_fee', NEW.id::text, NEW.id::text, NEW.id, 'confirmed', 0.95,
            jsonb_build_object('fee_id', v_fee.id, 'fee_pct', v_fee.fee_pct, 'fixed_fee', v_fee.fixed_fee, 'gross', NEW.total)
          ) ON CONFLICT (external_source, external_id) DO NOTHING;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_sales_cash_flow_sync ON public.pos_sales;
CREATE TRIGGER pos_sales_cash_flow_sync
AFTER INSERT OR UPDATE OF status ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.trg_pos_sales_to_cash_flow();
