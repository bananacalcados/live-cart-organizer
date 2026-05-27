
-- 1. Add counterpart account and transfer pair to pos_cash_movements
ALTER TABLE public.pos_cash_movements
  ADD COLUMN IF NOT EXISTS counterpart_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_pair_id uuid;

-- 2. Seed required financial categories
INSERT INTO public.financial_categories (name, type, is_custom, is_active)
SELECT 'Transferência entre Contas', 'transfer', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.financial_categories WHERE name='Transferência entre Contas');

INSERT INTO public.financial_categories (name, type, is_custom, is_active)
SELECT 'Quebra de Caixa - Sobra', 'income', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.financial_categories WHERE name='Quebra de Caixa - Sobra');

INSERT INTO public.financial_categories (name, type, is_custom, is_active)
SELECT 'Quebra de Caixa - Falta', 'expense', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.financial_categories WHERE name='Quebra de Caixa - Falta');

-- 3. Trigger: sangria/reforço -> paired cash_flow_entries (transfer)
CREATE OR REPLACE FUNCTION public.trg_pos_cash_movement_to_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caixa_account_id uuid;
  v_pair_id uuid := gen_random_uuid();
  v_cat_id uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- Find the CAIXA LOJA account for this store
  SELECT id INTO v_caixa_account_id
  FROM public.bank_accounts
  WHERE store_id = NEW.store_id AND account_type = 'caixa_loja' AND is_active = true
  LIMIT 1;

  IF v_caixa_account_id IS NULL OR NEW.counterpart_bank_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_cat_id FROM public.financial_categories WHERE name='Transferência entre Contas' LIMIT 1;

  -- Persist pair id on the movement
  NEW.transfer_pair_id := v_pair_id;

  IF NEW.type = 'withdraw' THEN
    -- Sangria: saída do CAIXA LOJA, entrada na counterpart
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, is_transfer, transfer_pair_id, metadata)
    VALUES (NEW.store_id, v_today, 'out', NEW.amount, v_cat_id, v_caixa_account_id,
            'Sangria PDV → ' || COALESCE((SELECT name FROM public.bank_accounts WHERE id=NEW.counterpart_bank_account_id),'destino') ||
            CASE WHEN NEW.description IS NOT NULL THEN ' | ' || NEW.description ELSE '' END,
            'pos_cash_movement', true, v_pair_id, jsonb_build_object('pos_cash_movement_id', NEW.id));

    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, is_transfer, transfer_pair_id, metadata)
    VALUES (NEW.store_id, v_today, 'in', NEW.amount, v_cat_id, NEW.counterpart_bank_account_id,
            'Entrada via sangria do CAIXA' ||
            CASE WHEN NEW.description IS NOT NULL THEN ' | ' || NEW.description ELSE '' END,
            'pos_cash_movement', true, v_pair_id, jsonb_build_object('pos_cash_movement_id', NEW.id));

  ELSIF NEW.type = 'deposit' THEN
    -- Reforço: saída da counterpart, entrada no CAIXA LOJA
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, is_transfer, transfer_pair_id, metadata)
    VALUES (NEW.store_id, v_today, 'out', NEW.amount, v_cat_id, NEW.counterpart_bank_account_id,
            'Reforço para CAIXA PDV' ||
            CASE WHEN NEW.description IS NOT NULL THEN ' | ' || NEW.description ELSE '' END,
            'pos_cash_movement', true, v_pair_id, jsonb_build_object('pos_cash_movement_id', NEW.id));

    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, is_transfer, transfer_pair_id, metadata)
    VALUES (NEW.store_id, v_today, 'in', NEW.amount, v_cat_id, v_caixa_account_id,
            'Reforço PDV ← ' || COALESCE((SELECT name FROM public.bank_accounts WHERE id=NEW.counterpart_bank_account_id),'origem') ||
            CASE WHEN NEW.description IS NOT NULL THEN ' | ' || NEW.description ELSE '' END,
            'pos_cash_movement', true, v_pair_id, jsonb_build_object('pos_cash_movement_id', NEW.id));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_cash_movement_to_transfer ON public.pos_cash_movements;
CREATE TRIGGER pos_cash_movement_to_transfer
BEFORE INSERT ON public.pos_cash_movements
FOR EACH ROW EXECUTE FUNCTION public.trg_pos_cash_movement_to_transfer();

-- 4. Trigger: closing register with difference -> Quebra de Caixa entry
CREATE OR REPLACE FUNCTION public.trg_pos_register_close_quebra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caixa_account_id uuid;
  v_cat_id uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_diff numeric;
BEGIN
  -- Only fire when transitioning to closed
  IF NEW.status <> 'closed' OR COALESCE(OLD.status,'') = 'closed' THEN
    RETURN NEW;
  END IF;

  v_diff := COALESCE(NEW.difference, 0);
  IF v_diff = 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_caixa_account_id
  FROM public.bank_accounts
  WHERE store_id = NEW.store_id AND account_type = 'caixa_loja' AND is_active = true
  LIMIT 1;

  IF v_caixa_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_diff > 0 THEN
    SELECT id INTO v_cat_id FROM public.financial_categories WHERE name='Quebra de Caixa - Sobra' LIMIT 1;
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, metadata)
    VALUES (NEW.store_id, v_today, 'in', v_diff, v_cat_id, v_caixa_account_id,
            'Quebra de caixa (sobra) — fechamento PDV',
            'pos_cash_register_close',
            jsonb_build_object('pos_cash_register_id', NEW.id, 'expected', NEW.expected_balance, 'closing', NEW.closing_balance));
  ELSE
    SELECT id INTO v_cat_id FROM public.financial_categories WHERE name='Quebra de Caixa - Falta' LIMIT 1;
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, metadata)
    VALUES (NEW.store_id, v_today, 'out', ABS(v_diff), v_cat_id, v_caixa_account_id,
            'Quebra de caixa (falta) — fechamento PDV',
            'pos_cash_register_close',
            jsonb_build_object('pos_cash_register_id', NEW.id, 'expected', NEW.expected_balance, 'closing', NEW.closing_balance));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_register_close_quebra ON public.pos_cash_registers;
CREATE TRIGGER pos_register_close_quebra
AFTER UPDATE ON public.pos_cash_registers
FOR EACH ROW EXECUTE FUNCTION public.trg_pos_register_close_quebra();
