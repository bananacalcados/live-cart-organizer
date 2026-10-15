CREATE TABLE public.gateway_split_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  percentages jsonb NOT NULL DEFAULT '{"mercadopago":100,"pagarme":0,"appmax":0,"austpay":0}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.gateway_split_config TO authenticated;
GRANT ALL ON public.gateway_split_config TO service_role;
ALTER TABLE public.gateway_split_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read split" ON public.gateway_split_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins insert split" ON public.gateway_split_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update split" ON public.gateway_split_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.gateway_split_config_history (
  id bigserial PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  old_enabled boolean,
  new_enabled boolean,
  old_percentages jsonb,
  new_percentages jsonb
);
GRANT SELECT ON public.gateway_split_config_history TO authenticated;
GRANT ALL ON public.gateway_split_config_history TO service_role;
ALTER TABLE public.gateway_split_config_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read split history" ON public.gateway_split_config_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.gateway_split_validate_and_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; v numeric; total numeric := 0;
BEGIN
  FOR k, v IN SELECT key, (value)::numeric FROM jsonb_each_text(NEW.percentages) LOOP
    IF k NOT IN ('mercadopago','pagarme','appmax','austpay') THEN RAISE EXCEPTION 'Gateway desconhecido: %', k; END IF;
    IF v < 0 OR v > 100 THEN RAISE EXCEPTION 'Percentual inválido para %', k; END IF;
    IF k = 'austpay' AND v > 0 THEN RAISE EXCEPTION 'AustPay está desativada'; END IF;
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
CREATE TRIGGER trg_gateway_split_validate BEFORE INSERT OR UPDATE ON public.gateway_split_config
FOR EACH ROW EXECUTE FUNCTION public.gateway_split_validate_and_log();

INSERT INTO public.gateway_split_config(id) VALUES (true) ON CONFLICT DO NOTHING;