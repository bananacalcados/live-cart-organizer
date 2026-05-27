
-- 1) Seed CAIXA accounts for physical stores (idempotent)
INSERT INTO public.bank_accounts (name, bank_name, account_type, initial_balance, store_id, is_active, notes)
SELECT 'CAIXA ' || s.name, 'Caixa Físico', 'caixa_loja', 0, s.id, true,
       'Dinheiro em espécie no caixa da loja ' || s.name || '. Alimentado automaticamente por vendas em dinheiro no PDV.'
FROM public.pos_stores s
WHERE s.id IN ('4ade7b44-5043-4ab1-a124-7a6ab5468e29','1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2')
  AND NOT EXISTS (
    SELECT 1 FROM public.bank_accounts b
     WHERE b.store_id = s.id AND b.account_type = 'caixa_loja'
  );

INSERT INTO public.bank_accounts (name, bank_name, account_type, initial_balance, store_id, is_active, notes)
SELECT 'CAIXA Geral', 'Caixa Físico', 'caixa_loja', 0, NULL, true, 'Caixa consolidado / genérico'
WHERE NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE name = 'CAIXA Geral');

-- 2) Update trigger: link cash sales to CAIXA bank account of the store
CREATE OR REPLACE FUNCTION public.trg_pos_sales_to_cash_flow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_bank_account_id uuid;
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

    -- If the sale is in cash, attribute to the store's CAIXA bank account
    IF v_method_label = 'Dinheiro' THEN
      SELECT id INTO v_bank_account_id
        FROM public.bank_accounts
       WHERE store_id = NEW.store_id
         AND account_type = 'caixa_loja'
         AND is_active = true
       LIMIT 1;
    END IF;

    -- Look up fee
    SELECT * INTO v_fee FROM public.payment_method_fees
     WHERE acquirer = v_acquirer AND product = v_product
       AND method = v_method
       AND (v_method NOT IN ('credit','credit_card','credito') OR installments = v_installments)
       AND is_active = true
     LIMIT 1;
    v_fee_amount := COALESCE(NEW.total,0) * COALESCE(v_fee.percent_fee,0)/100 + COALESCE(v_fee.fixed_fee,0);

    -- Insert income entry (avoid duplicate)
    INSERT INTO public.cash_flow_entries (
      entry_date, direction, amount, description, source, source_id,
      category_id, store_id, payment_method, status, confidence, bank_account_id
    )
    SELECT v_entry_date, 'in', NEW.total,
           'Venda PDV #' || COALESCE(NEW.sale_number::text, NEW.id::text) || ' (' || v_method_label || ')',
           'pos_sale', NEW.id::text, v_method_cat, NEW.store_id, v_method,
           'confirmed', 1, v_bank_account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cash_flow_entries
       WHERE source = 'pos_sale' AND source_id = NEW.id::text AND direction = 'in'
    );

    -- Fee as expense (only for card/online methods with fee > 0)
    IF v_fee_amount > 0 THEN
      SELECT id INTO v_fee_cat FROM public.financial_categories
       WHERE name ILIKE '%taxa%' AND type = 'expense' AND is_active = true LIMIT 1;
      INSERT INTO public.cash_flow_entries (
        entry_date, direction, amount, description, source, source_id,
        category_id, store_id, payment_method, status, confidence
      )
      SELECT v_entry_date, 'out', v_fee_amount,
             'Taxa ' || v_acquirer || ' ' || v_method_label || ' venda #' || COALESCE(NEW.sale_number::text, NEW.id::text),
             'pos_sale_fee', NEW.id::text, v_fee_cat, NEW.store_id, v_method,
             'confirmed', 1
      WHERE NOT EXISTS (
        SELECT 1 FROM public.cash_flow_entries
         WHERE source = 'pos_sale_fee' AND source_id = NEW.id::text AND direction = 'out'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
