
-- Apaga lançamentos vinculados ao CAIXA Geral (saldo zero, sem risco)
DELETE FROM public.cash_flow_entries
WHERE bank_account_id IN (
  SELECT id FROM public.bank_accounts WHERE name = 'CAIXA Geral'
);

DELETE FROM public.bank_accounts WHERE name = 'CAIXA Geral';

-- Cria conta COFRE
INSERT INTO public.bank_accounts (name, bank_name, account_type, initial_balance, is_active, notes)
VALUES ('COFRE', NULL, 'cofre', 0, true, 'Dinheiro retirado dos caixas das lojas, aguardando depósito bancário. Origem das transferências para contas bancárias.')
ON CONFLICT DO NOTHING;

-- Atualiza trigger pra remover fallback no CAIXA Geral
CREATE OR REPLACE FUNCTION public.trg_pos_sales_to_cash_flow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category_id uuid;
  v_bank_account_id uuid;
  v_store_name text;
  v_method text;
  v_category_name text;
BEGIN
  IF NEW.payment_method IS NULL THEN RETURN NEW; END IF;

  v_method := lower(NEW.payment_method);

  v_category_name := CASE v_method
    WHEN 'dinheiro' THEN 'Dinheiro'
    WHEN 'pix' THEN 'PIX'
    WHEN 'debito' THEN 'Débito'
    WHEN 'débito' THEN 'Débito'
    WHEN 'credito' THEN 'Crédito à vista'
    WHEN 'crédito' THEN 'Crédito à vista'
    WHEN 'credito_parcelado' THEN 'Crédito parcelado'
    WHEN 'crediario' THEN 'Crediário'
    WHEN 'crediário' THEN 'Crediário'
    ELSE 'Outros'
  END;

  SELECT fc.id INTO v_category_id
  FROM public.financial_categories fc
  JOIN public.financial_categories parent ON parent.id = fc.parent_id
  WHERE parent.name = 'Vendas PDV' AND fc.name = v_category_name
  LIMIT 1;

  -- Só vendas em dinheiro alimentam o CAIXA da loja específica
  IF v_method = 'dinheiro' AND NEW.store_id IS NOT NULL THEN
    SELECT name INTO v_store_name FROM public.stores WHERE id = NEW.store_id;
    IF v_store_name IS NOT NULL THEN
      SELECT id INTO v_bank_account_id
      FROM public.bank_accounts
      WHERE account_type = 'caixa_loja'
        AND (name ILIKE '%' || v_store_name || '%' OR store_id = NEW.store_id)
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.cash_flow_entries (
    entry_date, direction, amount, description, source, source_ref,
    store_id, category_id, bank_account_id, status, confidence
  ) VALUES (
    COALESCE(NEW.created_at::date, CURRENT_DATE),
    'in',
    NEW.total_amount,
    'Venda PDV #' || COALESCE(NEW.id::text, '') || ' (' || NEW.payment_method || ')',
    'pos_sale',
    NEW.id::text,
    NEW.store_id,
    v_category_id,
    v_bank_account_id,
    'confirmed',
    1
  );

  RETURN NEW;
END;
$$;
