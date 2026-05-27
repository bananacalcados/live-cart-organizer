DO $backfill$
DECLARE r record; v_caixa uuid; v_pair uuid; v_cat uuid; v_diff numeric; v_cs uuid; v_cf uuid;
BEGIN
  FOR r IN
    SELECT m.* FROM public.pos_cash_movements m
    WHERE NOT EXISTS (SELECT 1 FROM public.cash_flow_entries c WHERE c.source='pos_cash_movement' AND c.source_ref_id = m.id::text)
  LOOP
    SELECT id INTO v_caixa FROM public.bank_accounts WHERE account_type='caixa_loja' AND store_id=r.store_id AND is_active=true LIMIT 1;
    IF v_caixa IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_cat FROM public.financial_categories WHERE name='Transferência entre Contas' LIMIT 1;
    v_pair := gen_random_uuid();

    IF r.type='withdraw' THEN
      INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, is_transfer, transfer_pair_id, status, confidence, ledger)
      VALUES (r.store_id, r.created_at::date, 'out', r.amount, v_cat, v_caixa,
              'Sangria: ' || COALESCE(r.description,'—'), 'pos_cash_movement', r.id::text,
              r.counterpart_bank_account_id IS NOT NULL, v_pair, 'confirmed', 1, 'realidade');
      IF r.counterpart_bank_account_id IS NOT NULL THEN
        INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, is_transfer, transfer_pair_id, status, confidence, ledger)
        VALUES (r.store_id, r.created_at::date, 'in', r.amount, v_cat, r.counterpart_bank_account_id,
                'Entrada via sangria: ' || COALESCE(r.description,'—'), 'pos_cash_movement', r.id::text,
                true, v_pair, 'confirmed', 1, 'realidade');
      END IF;
    ELSIF r.type='deposit' THEN
      IF r.counterpart_bank_account_id IS NOT NULL THEN
        INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, is_transfer, transfer_pair_id, status, confidence, ledger)
        VALUES (r.store_id, r.created_at::date, 'out', r.amount, r.counterpart_bank_account_id, r.counterpart_bank_account_id,
                'Saída p/ reforço: ' || COALESCE(r.description,'—'), 'pos_cash_movement', r.id::text,
                true, v_pair, 'confirmed', 1, 'realidade');
      END IF;
      INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, is_transfer, transfer_pair_id, status, confidence, ledger)
      VALUES (r.store_id, r.created_at::date, 'in', r.amount, v_cat, v_caixa,
              'Reforço: ' || COALESCE(r.description,'—'), 'pos_cash_movement', r.id::text,
              r.counterpart_bank_account_id IS NOT NULL, v_pair, 'confirmed', 1, 'realidade');
    END IF;
  END LOOP;
END;
$backfill$;