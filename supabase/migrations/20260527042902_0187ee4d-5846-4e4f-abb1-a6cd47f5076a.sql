
CREATE OR REPLACE FUNCTION public.pos_sale_to_faturamento(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s public.pos_sales%ROWTYPE;
  v_outros_cat uuid; v_total numeric; v_pm_raw text; v_match text[];
  v_method_label text; v_method_norm text; v_amount numeric;
  v_cat_id uuid; v_bank_id uuid;
  v_sum_parsed numeric := 0; v_has_breakdown boolean := false;
BEGIN
  SELECT * INTO s FROM public.pos_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF s.status NOT IN ('paid','completed') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_flow_entries WHERE source='pos_sale' AND source_ref_id = s.id::text) THEN RETURN; END IF;

  v_total := COALESCE(s.total, 0);
  IF v_total <= 0 THEN RETURN; END IF;
  v_pm_raw := COALESCE(s.payment_method, '');

  SELECT fc.id INTO v_outros_cat FROM public.financial_categories fc
  JOIN public.financial_categories p ON p.id=fc.parent_id
  WHERE p.name='Vendas PDV' AND fc.name='Outros' LIMIT 1;

  FOR v_match IN
    SELECT regexp_matches(v_pm_raw, '([A-Za-zÀ-ÿ\- ]+?)\s*\(R\$\s*([0-9]+(?:[\.,][0-9]+)?)\)', 'g')
  LOOP
    v_has_breakdown := true;
    v_method_label := lower(trim(v_match[1]));
    v_amount := replace(v_match[2], ',', '.')::numeric;
    v_sum_parsed := v_sum_parsed + v_amount;

    v_method_norm := CASE
      WHEN v_method_label LIKE '%dinheiro%' THEN 'Dinheiro'
      WHEN v_method_label LIKE '%pix%' THEN 'PIX'
      WHEN v_method_label LIKE '%débito%' OR v_method_label LIKE '%debito%' THEN 'Débito'
      WHEN v_method_label LIKE '%crédito%' OR v_method_label LIKE '%credito%' THEN
        CASE WHEN v_method_label ~ '\d+x' THEN 'Crédito parcelado' ELSE 'Crédito à vista' END
      WHEN v_method_label LIKE '%crediário%' OR v_method_label LIKE '%crediario%' THEN 'Crediário'
      ELSE 'Outros'
    END;

    SELECT fc.id INTO v_cat_id FROM public.financial_categories fc
      JOIN public.financial_categories p ON p.id=fc.parent_id
      WHERE p.name='Vendas PDV' AND fc.name=v_method_norm LIMIT 1;

    v_bank_id := NULL;
    IF v_method_norm = 'Dinheiro' THEN
      SELECT id INTO v_bank_id FROM public.bank_accounts
        WHERE account_type='caixa_loja' AND store_id=s.store_id AND is_active=true LIMIT 1;
    END IF;

    INSERT INTO public.cash_flow_entries (
      entry_date, direction, amount, description, source, source_ref_id,
      store_id, category_id, bank_account_id, pos_sale_id, status, confidence, ledger
    ) VALUES (
      COALESCE(s.paid_at::date, s.created_at::date, CURRENT_DATE),
      'in', v_amount, 'Venda PDV — ' || v_method_norm,
      'pos_sale', s.id::text, s.store_id, COALESCE(v_cat_id, v_outros_cat),
      v_bank_id, s.id, 'confirmed', 1, 'faturamento'
    );
  END LOOP;

  IF NOT v_has_breakdown THEN
    v_method_label := lower(v_pm_raw);
    v_method_norm := CASE
      WHEN v_method_label LIKE '%dinheiro%' THEN 'Dinheiro'
      WHEN v_method_label LIKE '%pix%' THEN 'PIX'
      WHEN v_method_label LIKE '%débito%' OR v_method_label LIKE '%debito%' THEN 'Débito'
      WHEN v_method_label LIKE '%crédito%' OR v_method_label LIKE '%credito%' OR v_method_label LIKE '%credit_card%' THEN
        CASE WHEN v_method_label ~ '\d+x' THEN 'Crédito parcelado' ELSE 'Crédito à vista' END
      WHEN v_method_label LIKE '%crediário%' OR v_method_label LIKE '%crediario%' THEN 'Crediário'
      ELSE 'Outros'
    END;

    SELECT fc.id INTO v_cat_id FROM public.financial_categories fc
      JOIN public.financial_categories p ON p.id=fc.parent_id
      WHERE p.name='Vendas PDV' AND fc.name=v_method_norm LIMIT 1;

    v_bank_id := NULL;
    IF v_method_norm = 'Dinheiro' THEN
      SELECT id INTO v_bank_id FROM public.bank_accounts
        WHERE account_type='caixa_loja' AND store_id=s.store_id AND is_active=true LIMIT 1;
    END IF;

    INSERT INTO public.cash_flow_entries (
      entry_date, direction, amount, description, source, source_ref_id,
      store_id, category_id, bank_account_id, pos_sale_id, status, confidence, ledger
    ) VALUES (
      COALESCE(s.paid_at::date, s.created_at::date, CURRENT_DATE),
      'in', v_total, 'Venda PDV — ' || COALESCE(NULLIF(v_pm_raw,''), v_method_norm),
      'pos_sale', s.id::text, s.store_id, COALESCE(v_cat_id, v_outros_cat),
      v_bank_id, s.id, 'confirmed', 1, 'faturamento'
    );
  ELSIF (v_total - v_sum_parsed) > 1 THEN
    INSERT INTO public.cash_flow_entries (
      entry_date, direction, amount, description, source, source_ref_id,
      store_id, category_id, bank_account_id, pos_sale_id, status, confidence, ledger
    ) VALUES (
      COALESCE(s.paid_at::date, s.created_at::date, CURRENT_DATE),
      'in', v_total - v_sum_parsed, 'Venda PDV — diferença não parseada',
      'pos_sale', s.id::text, s.store_id, v_outros_cat,
      NULL, s.id, 'needs_review', 0.5, 'faturamento'
    );
  END IF;
END;
$function$;

-- Re-run backfill (the other triggers/functions are already in place from prior partial run; recreate to be safe)
CREATE OR REPLACE FUNCTION public.trg_pos_sales_to_cash_flow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.pos_sale_to_faturamento(NEW.id); RETURN NEW; END; $$;

DO $backfill$
DECLARE r record; v_caixa uuid; v_pair uuid; v_cat uuid; v_diff numeric; v_cs uuid; v_cf uuid;
BEGIN
  FOR r IN
    SELECT id FROM public.pos_sales
    WHERE status IN ('paid','completed') AND COALESCE(total,0) > 0
      AND NOT EXISTS (SELECT 1 FROM public.cash_flow_entries c WHERE c.source='pos_sale' AND c.source_ref_id = pos_sales.id::text)
  LOOP
    PERFORM public.pos_sale_to_faturamento(r.id);
  END LOOP;

  FOR r IN
    SELECT m.* FROM public.pos_cash_movements m
    WHERE NOT EXISTS (SELECT 1 FROM public.cash_flow_entries c WHERE c.source='pos_cash_movement' AND c.source_ref_id = m.id::text)
  LOOP
    SELECT id INTO v_caixa FROM public.bank_accounts WHERE account_type='caixa_loja' AND store_id=r.store_id AND is_active=true LIMIT 1;
    IF v_caixa IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_cat FROM public.financial_categories WHERE name='Transferência entre Contas' LIMIT 1;
    v_pair := gen_random_uuid();

    IF r.type='sangria' THEN
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
    ELSIF r.type='reforco' THEN
      IF r.counterpart_bank_account_id IS NOT NULL THEN
        INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, is_transfer, transfer_pair_id, status, confidence, ledger)
        VALUES (r.store_id, r.created_at::date, 'out', r.amount, v_cat, r.counterpart_bank_account_id,
                'Saída p/ reforço: ' || COALESCE(r.description,'—'), 'pos_cash_movement', r.id::text,
                true, v_pair, 'confirmed', 1, 'realidade');
      END IF;
      INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, is_transfer, transfer_pair_id, status, confidence, ledger)
      VALUES (r.store_id, r.created_at::date, 'in', r.amount, v_cat, v_caixa,
              'Reforço: ' || COALESCE(r.description,'—'), 'pos_cash_movement', r.id::text,
              r.counterpart_bank_account_id IS NOT NULL, v_pair, 'confirmed', 1, 'realidade');
    END IF;
  END LOOP;

  FOR r IN
    SELECT cr.* FROM public.pos_cash_registers cr
    WHERE cr.closed_at IS NOT NULL
      AND COALESCE(cr.closing_balance,0) <> COALESCE(cr.expected_balance,0)
      AND NOT EXISTS (SELECT 1 FROM public.cash_flow_entries c WHERE c.source='pos_register_close' AND c.source_ref_id = cr.id::text)
  LOOP
    v_diff := COALESCE(r.closing_balance,0) - COALESCE(r.expected_balance,0);
    SELECT id INTO v_caixa FROM public.bank_accounts WHERE account_type='caixa_loja' AND store_id=r.store_id AND is_active=true LIMIT 1;
    IF v_caixa IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_cs FROM public.financial_categories WHERE name='Quebra de Caixa - Sobra' LIMIT 1;
    SELECT id INTO v_cf FROM public.financial_categories WHERE name='Quebra de Caixa - Falta' LIMIT 1;
    IF v_diff > 0 THEN
      INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, status, confidence, ledger)
      VALUES (r.store_id, COALESCE(r.closed_at::date,CURRENT_DATE), 'in', v_diff, v_cs, v_caixa,
              'Quebra de caixa (sobra) — fechamento ' || r.id::text, 'pos_register_close', r.id::text, 'confirmed', 1, 'realidade');
    ELSE
      INSERT INTO public.cash_flow_entries (store_id, entry_date, direction, amount, category_id, bank_account_id, description, source, source_ref_id, status, confidence, ledger)
      VALUES (r.store_id, COALESCE(r.closed_at::date,CURRENT_DATE), 'out', abs(v_diff), v_cf, v_caixa,
              'Quebra de caixa (falta) — fechamento ' || r.id::text, 'pos_register_close', r.id::text, 'confirmed', 1, 'realidade');
    END IF;
  END LOOP;
END $backfill$;
