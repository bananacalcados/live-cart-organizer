CREATE OR REPLACE FUNCTION public.trg_pos_register_close_quebra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_diff numeric;
  v_caixa_account_id uuid;
  v_store_name text;
  v_cat_sobra uuid;
  v_cat_falta uuid;
BEGIN
  IF NEW.closed_at IS NULL OR OLD.closed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_diff := COALESCE(NEW.closing_balance, 0) - COALESCE(NEW.expected_balance, 0);
  IF v_diff = 0 THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_store_name
  FROM public.pos_stores
  WHERE id = NEW.store_id;

  SELECT id INTO v_caixa_account_id
  FROM public.bank_accounts
  WHERE account_type = 'caixa_loja'
    AND (name ILIKE '%' || COALESCE(v_store_name, '') || '%' OR store_id = NEW.store_id)
  LIMIT 1;

  IF v_caixa_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_cat_sobra
  FROM public.financial_categories
  WHERE name = 'Quebra de Caixa - Sobra'
  LIMIT 1;

  SELECT id INTO v_cat_falta
  FROM public.financial_categories
  WHERE name = 'Quebra de Caixa - Falta'
  LIMIT 1;

  IF v_diff > 0 THEN
    INSERT INTO public.cash_flow_entries (
      store_id,
      entry_date,
      direction,
      amount,
      category_id,
      bank_account_id,
      description,
      source,
      source_ref_id,
      status,
      confidence,
      ledger
    )
    VALUES (
      NEW.store_id,
      COALESCE(NEW.closed_at::date, CURRENT_DATE),
      'in',
      v_diff,
      v_cat_sobra,
      v_caixa_account_id,
      'Quebra de caixa (sobra) - fechamento #' || NEW.id::text,
      'pos_register_close',
      NEW.id::text,
      'confirmed',
      1,
      'realidade'
    );
  ELSE
    INSERT INTO public.cash_flow_entries (
      store_id,
      entry_date,
      direction,
      amount,
      category_id,
      bank_account_id,
      description,
      source,
      source_ref_id,
      status,
      confidence,
      ledger
    )
    VALUES (
      NEW.store_id,
      COALESCE(NEW.closed_at::date, CURRENT_DATE),
      'out',
      ABS(v_diff),
      v_cat_falta,
      v_caixa_account_id,
      'Quebra de caixa (falta) - fechamento #' || NEW.id::text,
      'pos_register_close',
      NEW.id::text,
      'confirmed',
      1,
      'realidade'
    );
  END IF;

  RETURN NEW;
END;
$function$;