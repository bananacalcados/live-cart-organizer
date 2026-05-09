
CREATE TABLE IF NOT EXISTS public.pos_cashback_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  percentage numeric NOT NULL DEFAULT 5,
  validity_days integer NOT NULL DEFAULT 60,
  min_sale_value numeric NOT NULL DEFAULT 0,
  min_purchase_multiplier numeric NOT NULL DEFAULT 1.5,
  max_cashback numeric,
  code_prefix text NOT NULL DEFAULT 'CB',
  cooldown_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_cashback_config_store
  ON public.pos_cashback_config ((COALESCE(store_id::text, 'GLOBAL')));

ALTER TABLE public.pos_cashback_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth access pos_cashback_config"
  ON public.pos_cashback_config
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_pos_cashback_config_updated_at
  BEFORE UPDATE ON public.pos_cashback_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default global config
INSERT INTO public.pos_cashback_config (store_id, is_enabled, percentage, validity_days, min_sale_value, min_purchase_multiplier, code_prefix)
SELECT NULL, true, 5, 60, 0, 1.5, 'CB'
WHERE NOT EXISTS (SELECT 1 FROM public.pos_cashback_config WHERE store_id IS NULL);
