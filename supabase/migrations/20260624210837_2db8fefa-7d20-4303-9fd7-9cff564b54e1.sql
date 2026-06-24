-- ========== Etapa 2: modelo de dados das campanhas de carrossel ==========

-- 1) Campanhas
CREATE TABLE public.campanhas_auto (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'lancamento' CHECK (tipo IN ('lancamento','numeracao')),
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  top_body text NOT NULL DEFAULT '',
  card_body text NOT NULL DEFAULT '',
  variaveis jsonb NOT NULL DEFAULT '[]'::jsonb,
  botoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  filtro_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  qtd_por_dia integer NOT NULL DEFAULT 50 CHECK (qtd_por_dia > 0),
  dias_semana integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  cooldown_dias integer NOT NULL DEFAULT 30 CHECK (cooldown_dias >= 0),
  rodizio_vendedora boolean NOT NULL DEFAULT true,
  vendedoras_rodizio uuid[],
  ativa boolean NOT NULL DEFAULT false,
  criada_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campanhas_auto TO authenticated;
GRANT ALL ON public.campanhas_auto TO service_role;
ALTER TABLE public.campanhas_auto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage campanhas_auto" ON public.campanhas_auto
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Cards da campanha
CREATE TABLE public.campanha_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campanha_id uuid NOT NULL REFERENCES public.campanhas_auto(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  shopify_product_id text,
  shopify_variant_id text,
  imagem_url text,
  legenda text,
  botao_tipo text,
  botao_payload jsonb,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','esgotado','inativo')),
  ultima_verificacao timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campanha_cards_campanha ON public.campanha_cards(campanha_id, ordem);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campanha_cards TO authenticated;
GRANT ALL ON public.campanha_cards TO service_role;
ALTER TABLE public.campanha_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage campanha_cards" ON public.campanha_cards
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) Log de envios (dedup / cooldown)
CREATE TABLE public.campanha_envios (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campanha_id uuid NOT NULL REFERENCES public.campanhas_auto(id) ON DELETE CASCADE,
  cliente_id uuid,
  phone text,
  phone_suffix8 text,
  vendedora_id uuid,
  vendedora_nome text,
  message_wamid text,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','enviado','entregue','lido','falhou','capped')),
  erro text,
  tentativas integer NOT NULL DEFAULT 0,
  proxima_tentativa timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campanha_envios_campanha ON public.campanha_envios(campanha_id, status);
CREATE INDEX idx_campanha_envios_cliente ON public.campanha_envios(cliente_id);
CREATE INDEX idx_campanha_envios_suffix ON public.campanha_envios(phone_suffix8);
CREATE INDEX idx_campanha_envios_wamid ON public.campanha_envios(message_wamid)
  WHERE message_wamid IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campanha_envios TO authenticated;
GRANT ALL ON public.campanha_envios TO service_role;
ALTER TABLE public.campanha_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage campanha_envios" ON public.campanha_envios
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- updated_at triggers
CREATE TRIGGER update_campanhas_auto_updated_at BEFORE UPDATE ON public.campanhas_auto
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_campanha_cards_updated_at BEFORE UPDATE ON public.campanha_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_campanha_envios_updated_at BEFORE UPDATE ON public.campanha_envios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) VIEW consolidada para o teto global de marketing
CREATE VIEW public.marketing_envios_globais
WITH (security_invoker = on) AS
  SELECT 'campanha_carrossel'::text AS origem,
         ce.campanha_id::text       AS origem_id,
         ce.phone                   AS phone,
         right(regexp_replace(coalesce(ce.phone,''), '\D', '', 'g'), 8) AS phone_suffix8,
         ce.enviado_em              AS enviado_em,
         ce.status                  AS status
    FROM public.campanha_envios ce
   WHERE ce.status IN ('enviado','entregue','lido')
  UNION ALL
  SELECT 'dispatch_recipients'::text,
         dr.dispatch_id::text,
         dr.phone,
         right(regexp_replace(coalesce(dr.phone,''), '\D', '', 'g'), 8),
         coalesce(dr.sent_at, dr.created_at),
         dr.status
    FROM public.dispatch_recipients dr
   WHERE dr.status IN ('sent','delivered','read')
  UNION ALL
  SELECT 'automation_dispatch_sent'::text,
         ads.flow_id::text,
         ads.phone,
         right(regexp_replace(coalesce(ads.phone,''), '\D', '', 'g'), 8),
         ads.sent_at,
         'sent'::text
    FROM public.automation_dispatch_sent ads;

GRANT SELECT ON public.marketing_envios_globais TO authenticated;
GRANT SELECT ON public.marketing_envios_globais TO service_role;