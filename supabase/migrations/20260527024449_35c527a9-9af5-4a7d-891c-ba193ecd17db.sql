
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS initial_balance numeric(14,2) NOT NULL DEFAULT 0;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;

ALTER TABLE public.cash_flow_entries
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_pair_id uuid,
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciled_with_id uuid REFERENCES public.cash_flow_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_status text;

CREATE INDEX IF NOT EXISTS idx_cf_bank_account ON public.cash_flow_entries(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_cf_transfer_pair ON public.cash_flow_entries(transfer_pair_id);
CREATE INDEX IF NOT EXISTS idx_cf_reconciliation ON public.cash_flow_entries(reconciliation_status) WHERE reconciliation_status IS NOT NULL;

DO $$
DECLARE
  v_vendas_root uuid;
  v_pdv uuid;
  v_site uuid;
  v_old_root uuid;
  v_child_ids uuid[];
  pm text;
  pdv_methods text[] := ARRAY['Dinheiro','PIX','Débito','Crédito à vista','Crédito parcelado','Crediário','Outros'];
  site_methods text[] := ARRAY['PIX','Cartão','Boleto','Outros'];
BEGIN
  SELECT id INTO v_vendas_root FROM public.financial_categories
    WHERE name='Vendas' AND parent_id IS NULL AND type='income' LIMIT 1;
  IF v_vendas_root IS NULL THEN
    INSERT INTO public.financial_categories(name, type, is_custom, is_active)
    VALUES ('Vendas','income', false, true)
    RETURNING id INTO v_vendas_root;
  END IF;

  FOR v_old_root IN
    SELECT id FROM public.financial_categories
     WHERE parent_id IS NULL
       AND type='income'
       AND name IN ('Vendas PDV','Vendas Site','Vendas Live','Vendas Loja Física','Vendas Marketplace')
       AND id <> v_vendas_root
  LOOP
    SELECT COALESCE(array_agg(id), '{}') INTO v_child_ids
      FROM public.financial_categories WHERE parent_id = v_old_root;

    UPDATE public.cash_flow_entries SET category_id = v_vendas_root
      WHERE category_id = v_old_root OR category_id = ANY(v_child_ids);
    UPDATE public.bank_transactions SET category_id = v_vendas_root
      WHERE category_id = v_old_root OR category_id = ANY(v_child_ids);
    UPDATE public.bank_transactions SET ai_category_id = v_vendas_root
      WHERE ai_category_id = v_old_root OR ai_category_id = ANY(v_child_ids);

    DELETE FROM public.financial_categories WHERE parent_id = v_old_root;
    DELETE FROM public.financial_categories WHERE id = v_old_root;
  END LOOP;

  INSERT INTO public.financial_categories(name, type, parent_id, is_custom, is_active)
  SELECT 'Vendas PDV','income', v_vendas_root, false, true
  WHERE NOT EXISTS (SELECT 1 FROM public.financial_categories WHERE name='Vendas PDV' AND parent_id=v_vendas_root);

  INSERT INTO public.financial_categories(name, type, parent_id, is_custom, is_active)
  SELECT 'Vendas Site','income', v_vendas_root, false, true
  WHERE NOT EXISTS (SELECT 1 FROM public.financial_categories WHERE name='Vendas Site' AND parent_id=v_vendas_root);

  SELECT id INTO v_pdv  FROM public.financial_categories WHERE name='Vendas PDV'  AND parent_id=v_vendas_root LIMIT 1;
  SELECT id INTO v_site FROM public.financial_categories WHERE name='Vendas Site' AND parent_id=v_vendas_root LIMIT 1;

  FOREACH pm IN ARRAY pdv_methods LOOP
    INSERT INTO public.financial_categories(name, type, parent_id, is_custom, is_active)
    SELECT pm,'income', v_pdv, false, true
    WHERE NOT EXISTS (SELECT 1 FROM public.financial_categories WHERE name=pm AND parent_id=v_pdv);
  END LOOP;
  FOREACH pm IN ARRAY site_methods LOOP
    INSERT INTO public.financial_categories(name, type, parent_id, is_custom, is_active)
    SELECT pm,'income', v_site, false, true
    WHERE NOT EXISTS (SELECT 1 FROM public.financial_categories WHERE name=pm AND parent_id=v_site);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_pos_sales_to_cash_flow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paid_statuses text[] := ARRAY['completed','paid','pending_sync','pending_pickup'];
  v_method text;
  v_method_label text;
  v_installments int;
  v_product text;
  v_acquirer text;
  v_fee public.payment_method_fees%ROWTYPE;
  v_fee_amount numeric;
  v_method_cat uuid;
  v_fee_cat uuid;
  v_entry_date date;
BEGIN
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
    v_product := CASE
      WHEN NEW.sale_type IN ('online','tiny_online') THEN 'mp_checkout'
      ELSE 'mp_point'
    END;
    v_entry_date := COALESCE(NEW.paid_at::date, NEW.created_at::date);

    v_method_label := CASE
      WHEN v_method IN ('cash','dinheiro','money') THEN 'Dinheiro'
      WHEN v_method = 'pix' THEN 'PIX'
      WHEN v_method IN ('debit','debit_card','debito') THEN 'Débito'
      WHEN v_method IN ('credit','credit_card','credito') AND v_installments <= 1 THEN 'Crédito à vista'
      WHEN v_method IN ('credit','credit_card','credito') AND v_installments > 1 THEN 'Crédito parcelado'
      WHEN v_method IN ('crediario','store_credit') THEN 'Crediário'
      ELSE 'Outros'
    END;

    SELECT c.id INTO v_method_cat
      FROM public.financial_categories c
      JOIN public.financial_categories p ON p.id = c.parent_id
      JOIN public.financial_categories g ON g.id = p.parent_id
     WHERE c.name = v_method_label
       AND p.name = 'Vendas PDV'
       AND g.name = 'Vendas'
     LIMIT 1;

    IF v_method_cat IS NULL THEN
      SELECT c.id INTO v_method_cat
        FROM public.financial_categories c
        JOIN public.financial_categories p ON p.id = c.parent_id
       WHERE c.name = 'Vendas PDV' AND p.name='Vendas' LIMIT 1;
    END IF;

    SELECT c.id INTO v_fee_cat FROM public.financial_categories c
      JOIN public.financial_categories p ON p.id=c.parent_id
      WHERE c.name='Mercado Pago' AND p.name='Taxas de Cartão' LIMIT 1;

    INSERT INTO public.cash_flow_entries (
      store_id, entry_date, direction, amount, category_id, payment_method,
      description, source, external_source, external_id, source_ref_id, pos_sale_id, status, confidence
    ) VALUES (
      NEW.store_id, v_entry_date, 'in', NEW.total, v_method_cat, v_method,
      'Venda PDV #' || COALESCE(NEW.invoice_number, NEW.id::text),
      'pos_sale', 'pos_sale', NEW.id::text, NEW.id::text, NEW.id, 'confirmed', 1.0
    ) ON CONFLICT (external_source, external_id) DO UPDATE
      SET category_id = EXCLUDED.category_id, amount = EXCLUDED.amount, payment_method = EXCLUDED.payment_method;

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
