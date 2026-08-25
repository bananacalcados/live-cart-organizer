CREATE OR REPLACE FUNCTION public.trg_pos_cash_movement_to_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caixa_account_id uuid;
  v_store_name text;
  v_pair_id uuid := gen_random_uuid();
  v_transfer_cat uuid;
BEGIN
  IF NEW.counterpart_bank_account_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_store_name FROM public.pos_stores WHERE id = NEW.store_id;
  SELECT id INTO v_caixa_account_id FROM public.bank_accounts
   WHERE account_type = 'caixa_loja'
     AND (store_id = NEW.store_id OR (v_store_name IS NOT NULL AND name ILIKE '%' || v_store_name || '%'))
   LIMIT 1;
  IF v_caixa_account_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_transfer_cat FROM public.financial_categories
   WHERE name = 'Transferência entre Contas' LIMIT 1;

  IF NEW.type = 'withdraw' THEN
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'out', NEW.amount, v_transfer_cat, v_caixa_account_id,
            'Sangria: ' || COALESCE(NEW.description, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'in', NEW.amount, v_transfer_cat, NEW.counterpart_bank_account_id,
            'Entrada via sangria: ' || COALESCE(NEW.description, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
  ELSIF NEW.type = 'deposit' THEN
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'out', NEW.amount, v_transfer_cat, NEW.counterpart_bank_account_id,
            'Saída p/ reforço: ' || COALESCE(NEW.description, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
    INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref, is_transfer, transfer_pair_id, status, confidence, ledger, metadata)
    VALUES (NEW.store_id, NEW.created_at::date, 'in', NEW.amount, v_transfer_cat, v_caixa_account_id,
            'Reforço: ' || COALESCE(NEW.description, '—'), 'pos_cash_movement', NEW.id::text, true, v_pair_id, 'confirmed', 1, 'realidade', jsonb_build_object('movement_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$function$;