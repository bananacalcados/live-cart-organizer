
-- ============================================================
-- FASE 2 · ETAPA 1: Memória do Estrategista + RPCs de leitura
-- ============================================================

CREATE TABLE public.agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  summary TEXT,
  summary_updated_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_conversations TO authenticated;
GRANT ALL ON public.agent_conversations TO service_role;
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage agent_conversations" ON public.agent_conversations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_agent_conversations_last_msg ON public.agent_conversations (last_message_at DESC);

CREATE TABLE public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content TEXT,
  tool_calls JSONB,
  pending_confirmation JSONB,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_messages TO authenticated;
GRANT ALL ON public.agent_messages TO service_role;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage agent_messages" ON public.agent_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_agent_messages_conv ON public.agent_messages (conversation_id, created_at);

CREATE TABLE public.agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('decisao','veto','regra_aprendida','pendencia')),
  descricao TEXT NOT NULL,
  motivo TEXT,
  contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT true,
  revisitar_apos TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_decisions TO authenticated;
GRANT ALL ON public.agent_decisions TO service_role;
ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage agent_decisions" ON public.agent_decisions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_agent_decisions_ativo ON public.agent_decisions (ativo, tipo, created_at DESC);

CREATE TABLE public.agent_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  mes_ref TEXT NOT NULL,
  data DATE NOT NULL,
  tipo_acao TEXT NOT NULL CHECK (tipo_acao IN
    ('live_grande','live_loja','disparo_semanal','campanha_estoque','acao_meta_ads','outro')),
  titulo TEXT NOT NULL,
  descricao TEXT,
  publico_alvo_descricao TEXT,
  custo_estimado_brl NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'planejado'
    CHECK (status IN ('planejado','executado','cancelado')),
  live_event_id UUID,  -- sem FK: pode apontar para live_sessions ou live_campaigns futuros
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_calendar TO authenticated;
GRANT ALL ON public.agent_calendar TO service_role;
ALTER TABLE public.agent_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage agent_calendar" ON public.agent_calendar
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_agent_calendar_mes ON public.agent_calendar (mes_ref, data);

CREATE TABLE public.monthly_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mes_ref TEXT NOT NULL,
  loja TEXT NOT NULL CHECK (loja IN ('perola','centro','shopify','live','total')),
  meta_faturamento_brl NUMERIC(12,2) NOT NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mes_ref, loja)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_goals TO authenticated;
GRANT ALL ON public.monthly_goals TO service_role;
ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage monthly_goals" ON public.monthly_goals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_agent_conversations_updated BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_agent_decisions_updated BEFORE UPDATE ON public.agent_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_agent_calendar_updated BEFORE UPDATE ON public.agent_calendar
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_monthly_goals_updated BEFORE UPDATE ON public.monthly_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Migração leve: anotações herdadas viram regra_aprendida inativa
INSERT INTO public.agent_decisions (tipo, descricao, motivo, contexto, ativo)
SELECT
  'regra_aprendida',
  'Anotações herdadas de marketing_calendar_goals (' || year || '-' ||
    lpad(month::text,2,'0') || ')',
  'Migração da Fase 2 · Etapa 1',
  jsonb_build_object('origem','marketing_calendar_goals','year',year,'month',month,
                     'actions',actions,'notes',notes,'goals',goals),
  false
FROM public.marketing_calendar_goals
WHERE actions IS NOT NULL OR notes IS NOT NULL
   OR (goals IS NOT NULL AND jsonb_typeof(goals)='array' AND jsonb_array_length(goals)>0);
COMMENT ON TABLE public.marketing_calendar_goals IS
  'DEPRECATED (Fase 2 · Etapa 1). Fonte única de metas passa a ser public.monthly_goals.';

-- ---------- RPCs DE LEITURA ----------

CREATE OR REPLACE FUNCTION public.get_classificacao_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'distribuicao', COALESCE((
      SELECT jsonb_object_agg(classe, qt) FROM (
        SELECT classificacao_rfm AS classe, count(*) AS qt
        FROM customers_unified
        WHERE merged_into_id IS NULL AND classificacao_rfm IS NOT NULL
        GROUP BY classificacao_rfm
      ) s
    ), '{}'::jsonb),
    'cotas', COALESCE((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT classe_cliente, tipo_disparo, cota_mensal, ativo
        FROM dispatch_touch_limits ORDER BY classe_cliente, tipo_disparo
      ) t
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_shadow_report(p_desde DATE, p_ate DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(s)) INTO result
  FROM (SELECT * FROM shadow_report_period
        WHERE dia BETWEEN p_desde AND p_ate ORDER BY dia DESC LIMIT 500) s;
  RETURN COALESCE(result, '[]'::jsonb);
END $$;

-- Usa live_sessions (existe) + live_campaigns
CREATE OR REPLACE FUNCTION public.get_live_events_summary(p_mes_ref TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(x)) INTO result FROM (
    SELECT id, started_at::date AS data, ended_at, peak_viewers, total_viewers,
           EXTRACT(DOW FROM started_at)::int IN (0,6) AS is_fim_de_semana
    FROM live_sessions
    WHERE to_char(started_at,'YYYY-MM') = p_mes_ref
    ORDER BY started_at DESC LIMIT 100
  ) x;
  RETURN COALESCE(result, '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.get_sales_vs_goals(p_mes_ref TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d_start DATE := to_date(p_mes_ref || '-01','YYYY-MM-DD');
  d_end   DATE := (d_start + interval '1 month')::date;
  today   DATE := CURRENT_DATE;
  days_elapsed INT := GREATEST(1, LEAST(today, d_end - 1) - d_start + 1);
  days_total INT := d_end - d_start;
  result JSONB;
BEGIN
  WITH vendas AS (
    SELECT
      CASE
        WHEN LOWER(COALESCE(s.nome_loja,'')) LIKE '%perola%' THEN 'perola'
        WHEN LOWER(COALESCE(s.nome_loja,'')) LIKE '%centro%' THEN 'centro'
        WHEN s.origem_venda IN ('live','live_shopping') THEN 'live'
        WHEN s.origem_venda = 'shopify' THEN 'shopify'
        ELSE 'total'
      END AS loja,
      SUM(s.total) AS faturado
    FROM pos_sales s
    WHERE s.status IN ('faturado','entregue','concluido','confirmed','delivered','completed')
      AND s.data_venda >= d_start AND s.data_venda < d_end
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'mes_ref', p_mes_ref,
    'dias_decorridos', days_elapsed, 'dias_totais', days_total,
    'por_loja', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'loja', g.loja,
        'meta', g.meta_faturamento_brl,
        'realizado', COALESCE(v.faturado,0),
        'projecao_linear', ROUND(COALESCE(v.faturado,0) * days_total::numeric / days_elapsed, 2),
        'pct_meta', CASE WHEN g.meta_faturamento_brl > 0
                         THEN ROUND(COALESCE(v.faturado,0)*100/g.meta_faturamento_brl, 1)
                         ELSE NULL END
      ))
      FROM monthly_goals g LEFT JOIN vendas v ON v.loja = g.loja
      WHERE g.mes_ref = p_mes_ref
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_rfm_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_clientes', (SELECT count(*) FROM customers_unified WHERE merged_into_id IS NULL),
    'por_classe', COALESCE((
      SELECT jsonb_object_agg(COALESCE(classificacao_rfm,'sem_classe'), qt)
      FROM (SELECT classificacao_rfm, count(*) AS qt FROM customers_unified
            WHERE merged_into_id IS NULL GROUP BY classificacao_rfm) t
    ), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_stock_by_size(p_filtros JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f_marca TEXT := p_filtros->>'marca';
  f_categoria TEXT := p_filtros->>'categoria';
  f_min_estoque INT := COALESCE((p_filtros->>'min_estoque')::int, 0);
  result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(x)) INTO result FROM (
    SELECT
      COALESCE(size,'sem_num') AS numeracao,
      COALESCE(brand,'sem_marca') AS marca,
      COALESCE(category,'sem_cat') AS categoria,
      SUM(stock) AS estoque_total,
      COUNT(DISTINCT id) AS num_variantes
    FROM pos_products
    WHERE is_active = true
      AND (f_marca IS NULL OR brand ILIKE '%'||f_marca||'%')
      AND (f_categoria IS NULL OR category ILIKE '%'||f_categoria||'%')
    GROUP BY 1,2,3
    HAVING SUM(stock) >= f_min_estoque
    ORDER BY estoque_total DESC LIMIT 200
  ) x;
  RETURN COALESCE(result, '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.get_leads_by_channel(p_desde DATE, p_ate DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  WITH todos AS (
    SELECT 'event_leads'::text AS canal, count(*) AS qt
      FROM event_leads WHERE created_at::date BETWEEN p_desde AND p_ate
    UNION ALL SELECT 'lp_leads', count(*) FROM lp_leads WHERE created_at::date BETWEEN p_desde AND p_ate
    UNION ALL SELECT 'link_page_leads', count(*) FROM link_page_leads WHERE created_at::date BETWEEN p_desde AND p_ate
    UNION ALL SELECT 'ad_leads', count(*) FROM ad_leads WHERE created_at::date BETWEEN p_desde AND p_ate
    UNION ALL SELECT 'catalog_lead_registrations', count(*) FROM catalog_lead_registrations
      WHERE created_at::date BETWEEN p_desde AND p_ate
  )
  SELECT jsonb_object_agg(canal, qt) INTO result FROM todos WHERE qt > 0;
  RETURN COALESCE(result, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.get_campaign_results(p_desde DATE, p_ate DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'campanhas_envios', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT date_trunc('day', created_at)::date AS dia,
               provider_at_send, template_category_at_send,
               count(*) AS envios, SUM(unit_cost_at_send) AS custo
        FROM campanha_envios WHERE created_at::date BETWEEN p_desde AND p_ate
        GROUP BY 1,2,3 ORDER BY 1 DESC LIMIT 100
      ) x
    ), '[]'::jsonb),
    'live_dispatches', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT date_trunc('day', created_at)::date AS dia,
               provider_at_send, template_category_at_send,
               count(*) AS envios, SUM(unit_cost_at_send) AS custo
        FROM live_campaign_dispatches WHERE created_at::date BETWEEN p_desde AND p_ate
        GROUP BY 1,2,3 ORDER BY 1 DESC LIMIT 100
      ) x
    ), '[]'::jsonb),
    'mass_dispatch', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT date_trunc('day', created_at)::date AS dia,
               provider_at_send, template_category_at_send,
               count(*) AS envios, SUM(unit_cost_at_send) AS custo
        FROM mass_dispatch_targets WHERE created_at::date BETWEEN p_desde AND p_ate
        GROUP BY 1,2,3 ORDER BY 1 DESC LIMIT 100
      ) x
    ), '[]'::jsonb),
    'automation', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT date_trunc('day', sent_at)::date AS dia,
               provider_at_send, template_category_at_send,
               count(*) AS envios, SUM(unit_cost_at_send) AS custo
        FROM automation_dispatch_sent WHERE sent_at::date BETWEEN p_desde AND p_ate
        GROUP BY 1,2,3 ORDER BY 1 DESC LIMIT 100
      ) x
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_dispatch_pressure(p_desde DATE, p_ate DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'toques_por_classe', COALESCE((
      SELECT jsonb_object_agg(classe, dados) FROM (
        SELECT COALESCE(cu.classificacao_rfm,'sem_classe') AS classe,
               jsonb_build_object(
                 'contatos_atingidos', count(DISTINCT ce.customer_id),
                 'toques_totais', count(*),
                 'toques_medios', ROUND(count(*)::numeric / NULLIF(count(DISTINCT ce.customer_id),0), 2)
               ) AS dados
        FROM campanha_envios ce
        LEFT JOIN customers_unified cu ON cu.id = ce.customer_id AND cu.merged_into_id IS NULL
        WHERE ce.created_at::date BETWEEN p_desde AND p_ate GROUP BY 1
      ) t
    ), '{}'::jsonb),
    'exposicao_grupos', COALESCE((
      SELECT jsonb_build_object(
        'contatos_expostos', count(DISTINCT customer_id),
        'exposicoes_totais', count(*)
      ) FROM group_message_exposures WHERE created_at::date BETWEEN p_desde AND p_ate
    ), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_agent_memory(p_mes_ref TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'decisoes_ativas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'tipo', tipo, 'descricao', descricao, 'motivo', motivo,
        'contexto', contexto, 'created_at', created_at, 'revisitar_apos', revisitar_apos
      )) FROM (
        SELECT * FROM agent_decisions
        WHERE ativo = true AND (revisitar_apos IS NULL OR revisitar_apos > now())
        ORDER BY created_at DESC LIMIT 100
      ) d
    ), '[]'::jsonb),
    'calendario_mes', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT id, data, tipo_acao, titulo, descricao, publico_alvo_descricao,
               custo_estimado_brl, status, live_event_id
        FROM agent_calendar
        WHERE p_mes_ref IS NULL OR mes_ref = p_mes_ref
        ORDER BY data LIMIT 200
      ) x
    ), '[]'::jsonb),
    'metas_mes', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT loja, meta_faturamento_brl, observacao FROM monthly_goals
        WHERE p_mes_ref IS NULL OR mes_ref = p_mes_ref
      ) x
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.get_classificacao_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shadow_report(DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_events_summary(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_vs_goals(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rfm_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_by_size(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leads_by_channel(DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_results(DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dispatch_pressure(DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_memory(TEXT) TO authenticated;
