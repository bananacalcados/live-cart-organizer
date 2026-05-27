
-- ============================================================
-- 1) Mapeamento método de pagamento → conta bancária (faturamento)
-- ============================================================
ALTER TABLE public.pos_payment_methods
  ADD COLUMN IF NOT EXISTS settlement_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_payment_methods_settlement ON public.pos_payment_methods(settlement_bank_account_id);

-- ============================================================
-- 2) Reorganiza plano de contas: Sangria + Quebras dentro de Financeiro
-- ============================================================
DO $$
DECLARE
  v_financeiro uuid;
  v_sangria uuid;
  v_quebra_falta uuid;
  v_quebra_sobra uuid;
BEGIN
  SELECT id INTO v_financeiro FROM public.financial_categories WHERE name = 'Financeiro' AND parent_id IS NULL LIMIT 1;
  IF v_financeiro IS NULL THEN
    INSERT INTO public.financial_categories (name, type, parent_id) VALUES ('Financeiro', 'expense', NULL) RETURNING id INTO v_financeiro;
  END IF;

  SELECT id INTO v_sangria FROM public.financial_categories WHERE name = 'Sangria' LIMIT 1;
  IF v_sangria IS NOT NULL THEN
    UPDATE public.financial_categories SET parent_id = v_financeiro, type = 'expense' WHERE id = v_sangria;
  END IF;

  SELECT id INTO v_quebra_falta FROM public.financial_categories WHERE name = 'Quebra de Caixa - Falta' LIMIT 1;
  IF v_quebra_falta IS NOT NULL THEN
    UPDATE public.financial_categories SET parent_id = v_financeiro, type = 'expense' WHERE id = v_quebra_falta;
  END IF;

  SELECT id INTO v_quebra_sobra FROM public.financial_categories WHERE name = 'Quebra de Caixa - Sobra' LIMIT 1;
  IF v_quebra_sobra IS NOT NULL THEN
    -- Sobra é receita; criar/garantir grupo Financeiro tipo income? Mantemos como receita standalone se já existe.
    -- Mover apenas se for despesa
    UPDATE public.financial_categories SET parent_id = NULL WHERE id = v_quebra_sobra AND type = 'income';
  END IF;
END $$;

-- ============================================================
-- 3) Trigger venda PDV: rota bank_account_id pra faturamento
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_pos_sales_to_cash_flow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_category_id uuid;
  v_method text;
  v_category_name text;
  v_bank_account_id uuid;
BEGIN
  IF NEW.payment_method IS NULL THEN RETURN NEW; END IF;
  v_method := lower(NEW.payment_method);
  v_category_name := CASE v_method
    WHEN 'dinheiro' THEN 'Dinheiro'
    WHEN 'pix' THEN 'PIX'
    WHEN 'debito' THEN 'Débito' WHEN 'débito' THEN 'Débito'
    WHEN 'credito' THEN 'Crédito à vista' WHEN 'crédito' THEN 'Crédito à vista'
    WHEN 'credito_parcelado' THEN 'Crédito parcelado'
    WHEN 'crediario' THEN 'Crediário' WHEN 'crediário' THEN 'Crediário'
    ELSE 'Outros'
  END;
  SELECT fc.id INTO v_category_id
  FROM public.financial_categories fc
  JOIN public.financial_categories parent ON parent.id = fc.parent_id
  WHERE parent.name = 'Vendas PDV' AND fc.name = v_category_name LIMIT 1;

  -- Rota para conta bancária no livro FATURAMENTO:
  --   dinheiro -> caixa_loja da loja
  --   demais -> settlement_bank_account_id em pos_payment_methods (se configurado)
  IF v_method = 'dinheiro' THEN
    SELECT id INTO v_bank_account_id FROM public.bank_accounts
      WHERE account_type = 'caixa_loja' AND store_id = NEW.store_id AND is_active = true
      LIMIT 1;
  ELSE
    SELECT ppm.settlement_bank_account_id INTO v_bank_account_id
      FROM public.pos_payment_methods ppm
      WHERE lower(ppm.id) = v_method
        AND (ppm.store_id = NEW.store_id OR ppm.store_id IS NULL)
        AND ppm.settlement_bank_account_id IS NOT NULL
      ORDER BY (ppm.store_id = NEW.store_id) DESC NULLS LAST
      LIMIT 1;
  END IF;

  INSERT INTO public.cash_flow_entries (
    entry_date, direction, amount, description, source, source_ref,
    store_id, category_id, bank_account_id, status, confidence, ledger
  ) VALUES (
    COALESCE(NEW.created_at::date, CURRENT_DATE), 'in', NEW.total_amount,
    'Venda PDV #' || COALESCE(NEW.id::text, '') || ' (' || NEW.payment_method || ')',
    'pos_sale', NEW.id::text, NEW.store_id, v_category_id,
    v_bank_account_id,
    'confirmed', 1, 'faturamento'
  );
  RETURN NEW;
END; $$;

-- ============================================================
-- 4) Backfill: vendas em dinheiro existentes -> caixa_loja
-- ============================================================
UPDATE public.cash_flow_entries cf
SET bank_account_id = ba.id
FROM public.bank_accounts ba
WHERE cf.ledger = 'faturamento'
  AND cf.source = 'pos_sale'
  AND cf.bank_account_id IS NULL
  AND cf.store_id IS NOT NULL
  AND ba.account_type = 'caixa_loja'
  AND ba.store_id = cf.store_id
  AND ba.is_active = true
  AND lower(cf.description) LIKE '%dinheiro%';
