
-- ============================================================================
-- MIGRATION 1 — provider_costs por categoria + template_category + snapshot
-- ============================================================================

-- 1) Reestrutura provider_costs: PK (provider, category)
CREATE TABLE public.provider_costs_new (
  provider text NOT NULL,
  category text NOT NULL DEFAULT 'default',
  cost_per_message_brl numeric(10,4) NOT NULL DEFAULT 0,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, category)
);

GRANT SELECT ON public.provider_costs_new TO authenticated;
GRANT ALL ON public.provider_costs_new TO service_role;
ALTER TABLE public.provider_costs_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read provider_costs_new" ON public.provider_costs_new FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins write provider_costs_new" ON public.provider_costs_new FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Seed (valores por categoria)
INSERT INTO public.provider_costs_new (provider, category, cost_per_message_brl, notes) VALUES
  ('meta_cloud','marketing',    0.4000, 'Meta Cloud API — templates de marketing (carrosséis, promoções). Editar quando Meta reajustar.'),
  ('meta_cloud','utility',      0.0500, 'Meta Cloud API — templates utilitários (confirmação, aviso). Editar quando Meta reajustar.'),
  ('meta_cloud','authentication',0.1000, 'Meta Cloud API — templates de autenticação (OTP).'),
  ('meta_cloud','service',      0.0000, 'Meta Cloud API — mensagens de serviço (janela 24h aberta pelo cliente). Sem custo.'),
  ('meta_cloud','default',      0.4000, 'Fallback quando categoria do template ainda não foi sincronizada da Meta.'),
  ('uazapi','default',          0.0000, 'Instância própria uazapi — sem custo por mensagem.'),
  ('zapi','default',            0.0000, 'Instância própria Z-API — sem custo por mensagem.'),
  ('wasender','default',        0.0000, 'Instância própria WaSender — sem custo por mensagem.');

-- Substitui tabela antiga
DROP TABLE public.provider_costs;
ALTER TABLE public.provider_costs_new RENAME TO provider_costs;
ALTER TABLE public.provider_costs RENAME CONSTRAINT provider_costs_new_pkey TO provider_costs_pkey;

CREATE TRIGGER update_provider_costs_updated_at
  BEFORE UPDATE ON public.provider_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) template_category no cadastro de templates de carrossel (Meta)
ALTER TABLE public.templates_carrossel
  ADD COLUMN IF NOT EXISTS template_category text,
  ADD COLUMN IF NOT EXISTS category_last_synced_at timestamptz;

-- 3) Tabela de alertas de reclassificação Meta (utility→marketing etc)
CREATE TABLE public.meta_template_category_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  previous_category text,
  new_category text NOT NULL,
  cost_previous_brl numeric(10,4),
  cost_new_brl numeric(10,4),
  cost_delta_pct numeric(10,2),
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.meta_template_category_alerts TO authenticated;
GRANT ALL ON public.meta_template_category_alerts TO service_role;
ALTER TABLE public.meta_template_category_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read alerts" ON public.meta_template_category_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "ack alerts" ON public.meta_template_category_alerts FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX idx_meta_template_category_alerts_unack
  ON public.meta_template_category_alerts (detected_at DESC)
  WHERE acknowledged = false;

CREATE TRIGGER update_meta_template_category_alerts_updated_at
  BEFORE UPDATE ON public.meta_template_category_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) SNAPSHOT de custo/categoria nas filas 1:1
-- campanha_envios (carrossel Meta Cloud 1:1)
ALTER TABLE public.campanha_envios
  ADD COLUMN IF NOT EXISTS template_category_at_send text,
  ADD COLUMN IF NOT EXISTS unit_cost_at_send numeric(10,4),
  ADD COLUMN IF NOT EXISTS provider_at_send text,
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;

-- dispatch_recipients (MassTemplateDispatcher)
ALTER TABLE public.dispatch_recipients
  ADD COLUMN IF NOT EXISTS template_category_at_send text,
  ADD COLUMN IF NOT EXISTS unit_cost_at_send numeric(10,4),
  ADD COLUMN IF NOT EXISTS provider_at_send text,
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;

-- live_campaign_dispatches
ALTER TABLE public.live_campaign_dispatches
  ADD COLUMN IF NOT EXISTS template_category_at_send text,
  ADD COLUMN IF NOT EXISTS unit_cost_at_send numeric(10,4),
  ADD COLUMN IF NOT EXISTS provider_at_send text,
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;

-- mass_dispatch_targets (vip-orphan-dispatch)
ALTER TABLE public.mass_dispatch_targets
  ADD COLUMN IF NOT EXISTS template_category_at_send text,
  ADD COLUMN IF NOT EXISTS unit_cost_at_send numeric(10,4),
  ADD COLUMN IF NOT EXISTS provider_at_send text,
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;

-- automation_dispatch_sent (automations)
ALTER TABLE public.automation_dispatch_sent
  ADD COLUMN IF NOT EXISTS template_category_at_send text,
  ADD COLUMN IF NOT EXISTS unit_cost_at_send numeric(10,4),
  ADD COLUMN IF NOT EXISTS provider_at_send text,
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unified_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS blocked_reason text;

-- 5) Snapshot também no cabeçalho do disparo (histórico agregado)
ALTER TABLE public.dispatch_history
  ADD COLUMN IF NOT EXISTS template_category_at_send text,
  ADD COLUMN IF NOT EXISTS unit_cost_at_send numeric(10,4),
  ADD COLUMN IF NOT EXISTS provider_at_send text,
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;

ALTER TABLE public.campanhas_auto
  ADD COLUMN IF NOT EXISTS template_categoria text,
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT true;
-- shadow_mode default TRUE nos carrosséis: durante ciclo shadow todos gravam mas não bloqueiam

ALTER TABLE public.live_campaigns
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT true;

ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT true;

ALTER TABLE public.mass_dispatch_campaigns
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT true;

-- 6) Helper: retorna custo unitário para (provider, category), com fallback default
CREATE OR REPLACE FUNCTION public.get_provider_cost(
  p_provider text,
  p_category text DEFAULT NULL
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT cost_per_message_brl FROM public.provider_costs
      WHERE provider = p_provider AND category = COALESCE(lower(p_category), 'default')),
    (SELECT cost_per_message_brl FROM public.provider_costs
      WHERE provider = p_provider AND category = 'default'),
    0
  )::numeric
$$;

-- 7) Helper: registra alerta de reclassificação se categoria mudou
CREATE OR REPLACE FUNCTION public.register_template_category_change(
  p_template_name text,
  p_language text,
  p_whatsapp_number_id uuid,
  p_new_category text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text;
  v_cost_prev numeric;
  v_cost_new numeric;
BEGIN
  SELECT template_category INTO v_prev
    FROM public.templates_carrossel
   WHERE template_id = p_template_name
     AND template_language = p_language
     AND (whatsapp_number_id = p_whatsapp_number_id OR whatsapp_number_id IS NULL)
   ORDER BY (whatsapp_number_id = p_whatsapp_number_id) DESC
   LIMIT 1;

  IF v_prev IS DISTINCT FROM p_new_category AND v_prev IS NOT NULL THEN
    v_cost_prev := public.get_provider_cost('meta_cloud', v_prev);
    v_cost_new  := public.get_provider_cost('meta_cloud', p_new_category);
    INSERT INTO public.meta_template_category_alerts (
      template_name, template_language, whatsapp_number_id,
      previous_category, new_category, cost_previous_brl, cost_new_brl,
      cost_delta_pct
    ) VALUES (
      p_template_name, p_language, p_whatsapp_number_id,
      v_prev, p_new_category, v_cost_prev, v_cost_new,
      CASE WHEN v_cost_prev > 0 THEN ROUND(((v_cost_new - v_cost_prev) / v_cost_prev) * 100, 2) ELSE NULL END
    );
  END IF;

  -- atualiza cadastro
  UPDATE public.templates_carrossel
     SET template_category = p_new_category,
         category_last_synced_at = now()
   WHERE template_id = p_template_name
     AND template_language = p_language
     AND (whatsapp_number_id = p_whatsapp_number_id OR whatsapp_number_id IS NULL);
END;
$$;
