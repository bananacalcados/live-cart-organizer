-- ============ FOLHA / Comissionamento de vendedoras ============

-- 1) Pessoa canônica (agrupa registros fragmentados de pos_sellers)
CREATE TABLE public.pos_commission_people (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  receives_all_lives boolean NOT NULL DEFAULT false,
  manual_goal_value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_commission_people TO authenticated;
GRANT ALL ON public.pos_commission_people TO service_role;
ALTER TABLE public.pos_commission_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage commission people"
  ON public.pos_commission_people FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 2) Liga cada registro pos_sellers a uma pessoa canônica
CREATE TABLE public.pos_commission_people_sellers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES public.pos_commission_people(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_commission_people_sellers TO authenticated;
GRANT ALL ON public.pos_commission_people_sellers TO service_role;
ALTER TABLE public.pos_commission_people_sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage commission people sellers"
  ON public.pos_commission_people_sellers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 3) Participantes da divisão do recebido das lives, por loja + período
CREATE TABLE public.pos_commission_live_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES public.pos_commission_people(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, store_id, period_start, period_end)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_commission_live_participants TO authenticated;
GRANT ALL ON public.pos_commission_live_participants TO service_role;
ALTER TABLE public.pos_commission_live_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage live participants"
  ON public.pos_commission_live_participants FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 4) Escala de comissionamento (editável)
CREATE TABLE public.pos_commission_scale (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  achievement_percent numeric NOT NULL,
  commission_percent numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (achievement_percent)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_commission_scale TO authenticated;
GRANT ALL ON public.pos_commission_scale TO service_role;
ALTER TABLE public.pos_commission_scale ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage commission scale"
  ON public.pos_commission_scale FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Semente da escala pedida
INSERT INTO public.pos_commission_scale (achievement_percent, commission_percent) VALUES
  (80, 0.5), (90, 0.7), (100, 1.0), (110, 1.2), (120, 1.5);

-- Trigger de updated_at (reusa função padrão se existir, senão cria)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_pos_commission_people_updated
  BEFORE UPDATE ON public.pos_commission_people
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_pos_commission_scale_updated
  BEFORE UPDATE ON public.pos_commission_scale
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();