CREATE OR REPLACE FUNCTION public.gateway_split_validate_and_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; v numeric; total numeric := 0;
BEGIN
  FOR k, v IN SELECT key, (value)::numeric FROM jsonb_each_text(NEW.percentages) LOOP
    IF k NOT IN ('mercadopago','pagarme','appmax','austpay') THEN RAISE EXCEPTION 'Gateway desconhecido: %', k; END IF;
    IF v < 0 OR v > 100 THEN RAISE EXCEPTION 'Percentual inválido para %', k; END IF;
    total := total + v;
  END LOOP;
  IF total <> 100 THEN RAISE EXCEPTION 'A soma dos percentuais deve ser 100 (atual: %)', total; END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  IF TG_OP = 'INSERT' OR OLD.enabled IS DISTINCT FROM NEW.enabled OR OLD.percentages IS DISTINCT FROM NEW.percentages THEN
    INSERT INTO public.gateway_split_config_history(changed_by, old_enabled, new_enabled, old_percentages, new_percentages)
    VALUES (auth.uid(), CASE WHEN TG_OP='UPDATE' THEN OLD.enabled END, NEW.enabled, CASE WHEN TG_OP='UPDATE' THEN OLD.percentages END, NEW.percentages);
  END IF;
  RETURN NEW;
END $$;