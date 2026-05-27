
-- ============================================================
-- 1) Adiciona coluna ledger
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.ledger_book AS ENUM ('faturamento', 'realidade');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.cash_flow_entries
  ADD COLUMN IF NOT EXISTS ledger public.ledger_book NOT NULL DEFAULT 'faturamento';

CREATE INDEX IF NOT EXISTS idx_cash_flow_entries_ledger ON public.cash_flow_entries(ledger);

-- ============================================================
-- 2) Backfill: PDV sales -> faturamento (e zera bank_account_id pra não inflar saldo)
-- ============================================================
UPDATE public.cash_flow_entries
SET ledger = 'faturamento', bank_account_id = NULL
WHERE source IN ('pos_sale', 'shopify_order', 'manual_sale')
  AND ledger = 'faturamento'; -- (já é default, só pra explicitar e zerar bank_account_id)

UPDATE public.cash_flow_entries
SET ledger = 'realidade'
WHERE source IN ('pos_cash_movement', 'pos_register_close', 'bank_statement_import', 'telegram_financial', 'manual_bank');

-- ============================================================
-- 3) Atualiza trigger de vendas PDV: sempre faturamento, sem bank_account_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_pos_sales_to_cash_flow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_category_id uuid;
  v_method text;
  v_category_name text;
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

  INSERT INTO public.cash_flow_entries (
    entry_date, direction, amount, description, source, source_ref,
    store_id, category_id, bank_account_id, status, confidence, ledger
  ) VALUES (
    COALESCE(NEW.created_at::date, CURRENT_DATE), 'in', NEW.total_amount,
    'Venda PDV #' || COALESCE(NEW.id::text, '') || ' (' || NEW.payment_method || ')',
    'pos_sale', NEW.id::text, NEW.store_id, v_category_id,
    NULL, -- faturamento não toca saldo de conta bancária
    'confirmed', 1, 'faturamento'
  );
  RETURN NEW;
END; $$;

-- ============================================================
-- 4) Atualiza trigger de sangria/reforço: sempre realidade
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_pos_cash_movement_to_transfer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caixa_account_id uuid;
  v_store_name text;
  v_pair_id uuid := gen_random_uuid();
  v_transfer_cat uuid;
BEGIN
  IF NEW.counterpart_bank_account_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_store_name FROM public.stores WHERE id = NEW.store_id;
  SELECT id INTO v_caixa_account_id FROM public.bank_accounts
   WHERE account_type = 'caixa_loja'
     AND (name ILIKE '%' || v_store_name || '%' OR store_id = NEW.store_id)
   LIMIT 1;
  IF v_caixa_account_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_transfer_cat FROM public.financial_categories
   WHERE name = 'Transferência entre Contas' LIMIT 1;

  IF NEW.movement_type = 'sangria' THEN
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'out', NEW.amount, v_transfer_cat, v_caixa_account_id,
            'Sangria: ' || COALESCE(NEW.reason, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'in', NEW.amount, v_transfer_cat, NEW.counterpart_bank_account_id,
            'Entrada via sangria: ' || COALESCE(NEW.reason, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
  ELSIF NEW.movement_type = 'reforco' THEN
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'out', NEW.amount, v_transfer_cat, NEW.counterpart_bank_account_id,
            'Saída p/ reforço: ' || COALESCE(NEW.reason, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'in', NEW.amount, v_transfer_cat, v_caixa_account_id,
            'Reforço: ' || COALESCE(NEW.reason, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
  END IF;
  RETURN NEW;
END; $$;

-- ============================================================
-- 5) Atualiza trigger de quebra de caixa: sempre realidade
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_pos_register_close_quebra()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_diff numeric;
  v_caixa_account_id uuid;
  v_store_name text;
  v_cat_sobra uuid;
  v_cat_falta uuid;
BEGIN
  IF NEW.closed_at IS NULL OR OLD.closed_at IS NOT NULL THEN RETURN NEW; END IF;
  v_diff := COALESCE(NEW.closing_cash, 0) - COALESCE(NEW.expected_cash, 0);
  IF v_diff = 0 THEN RETURN NEW; END IF;

  SELECT name INTO v_store_name FROM public.stores WHERE id = NEW.store_id;
  SELECT id INTO v_caixa_account_id FROM public.bank_accounts
   WHERE account_type = 'caixa_loja'
     AND (name ILIKE '%' || v_store_name || '%' OR store_id = NEW.store_id) LIMIT 1;
  IF v_caixa_account_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_cat_sobra FROM public.financial_categories WHERE name = 'Quebra de Caixa - Sobra' LIMIT 1;
  SELECT id INTO v_cat_falta FROM public.financial_categories WHERE name = 'Quebra de Caixa - Falta' LIMIT 1;

  IF v_diff > 0 THEN
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, status, confidence, ledger)
    VALUES (NEW.store_id, COALESCE(NEW.closed_at::date, CURRENT_DATE), 'in', v_diff, v_cat_sobra, v_caixa_account_id,
            'Quebra de caixa (sobra) - fechamento #' || NEW.id::text, 'pos_register_close', NEW.id::text, 'confirmed', 1, 'realidade');
  ELSE
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, status, confidence, ledger)
    VALUES (NEW.store_id, COALESCE(NEW.closed_at::date, CURRENT_DATE), 'out', ABS(v_diff), v_cat_falta, v_caixa_account_id,
            'Quebra de caixa (falta) - fechamento #' || NEW.id::text, 'pos_register_close', NEW.id::text, 'confirmed', 1, 'realidade');
  END IF;
  RETURN NEW;
END; $$;

-- ============================================================
-- 6) Reorganiza plano de contas: Taxas de Cartão -> Impostos e Taxas
-- ============================================================
DO $$
DECLARE
  v_impostos uuid;
  v_taxas uuid;
BEGIN
  SELECT id INTO v_impostos FROM public.financial_categories WHERE name = 'Impostos e Taxas' AND parent_id IS NULL LIMIT 1;
  IF v_impostos IS NULL THEN
    INSERT INTO public.financial_categories (name, type, parent_id) VALUES ('Impostos e Taxas', 'expense', NULL) RETURNING id INTO v_impostos;
  END IF;

  SELECT id INTO v_taxas FROM public.financial_categories WHERE name = 'Taxas de Cartão' LIMIT 1;
  IF v_taxas IS NULL THEN
    INSERT INTO public.financial_categories (name, type, parent_id) VALUES ('Taxas de Cartão', 'expense', v_impostos) RETURNING id INTO v_taxas;
  ELSE
    UPDATE public.financial_categories SET parent_id = v_impostos WHERE id = v_taxas;
  END IF;
END $$;
