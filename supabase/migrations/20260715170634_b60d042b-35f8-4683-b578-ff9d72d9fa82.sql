
-- Ampliar check constraint
ALTER TABLE public.dispatch_touch_limits DROP CONSTRAINT IF EXISTS dispatch_touch_limits_classificacao_check;
ALTER TABLE public.dispatch_touch_limits ADD CONSTRAINT dispatch_touch_limits_classificacao_check
  CHECK (classificacao = ANY (ARRAY['quente','morno','frio','silencio','silencio_reativavel','silencio_puro']));

-- Coluna espaçamento mínimo
ALTER TABLE public.dispatch_touch_limits
  ADD COLUMN IF NOT EXISTS min_dias_entre_toques integer NOT NULL DEFAULT 5;

-- Substituir 'silencio' pelas 2 novas classes
DELETE FROM public.dispatch_touch_limits WHERE classificacao = 'silencio';

INSERT INTO public.dispatch_touch_limits
  (classificacao, cota_mensal, tipos_permitidos, silencio_threshold_ignorados, min_dias_entre_toques, observacoes)
VALUES
  ('silencio_reativavel', 0, ARRAY[]::text[], 4, 30,
   'Não recebe disparo WhatsApp. Elegível apenas para exportação/custom audience (Meta Ads lookalike, e-mail).'),
  ('silencio_puro', 0, ARRAY[]::text[], 4, 30,
   'Bloqueado em qualquer canal outbound. Nunca comprou e ignorou threshold de disparos.')
ON CONFLICT (classificacao) DO UPDATE SET
  cota_mensal = EXCLUDED.cota_mensal,
  tipos_permitidos = EXCLUDED.tipos_permitidos,
  silencio_threshold_ignorados = EXCLUDED.silencio_threshold_ignorados,
  min_dias_entre_toques = EXCLUDED.min_dias_entre_toques,
  observacoes = EXCLUDED.observacoes,
  updated_at = now();

-- provider_costs
CREATE TABLE IF NOT EXISTS public.provider_costs (
  provider text PRIMARY KEY,
  cost_per_message_brl numeric(10,4) NOT NULL DEFAULT 0,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_costs TO authenticated;
GRANT ALL ON public.provider_costs TO service_role;

ALTER TABLE public.provider_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone authenticated can read provider_costs"
  ON public.provider_costs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can modify provider_costs"
  ON public.provider_costs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_provider_costs_updated_at
  BEFORE UPDATE ON public.provider_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.provider_costs (provider, cost_per_message_brl, notes) VALUES
  ('meta_cloud', 0.0500, 'Meta WhatsApp Cloud API — varia por categoria de template e reajustes Meta. Editar quando Meta atualizar tabela.'),
  ('uazapi',     0.0000, 'Instância própria — sem custo por mensagem.'),
  ('zapi',       0.0000, 'Instância própria — sem custo por mensagem.'),
  ('wasender',   0.0000, 'Instância própria — sem custo por mensagem.')
ON CONFLICT (provider) DO NOTHING;

-- Override por campanha
ALTER TABLE public.dispatch_history
  ADD COLUMN IF NOT EXISTS cost_override_brl numeric(10,4);

COMMENT ON COLUMN public.dispatch_history.cost_override_brl IS
  'Sobrescreve custo/msg do provider para esta campanha. NULL = usa provider_costs.cost_per_message_brl.';
