
-- =============================================
-- FASE 1: Estrutura 360° de Campanhas de Marketing
-- =============================================

-- 1. Adicionar campos extras à tabela marketing_campaigns
ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS budget numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attributed_revenue numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attributed_orders integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_captured integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS people_reached integer DEFAULT 0;

-- 2. Canais da campanha (WhatsApp, Instagram, Email, Loja Física, Site)
CREATE TABLE public.campaign_channels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  channel_type text NOT NULL, -- 'whatsapp', 'instagram', 'email', 'loja_fisica', 'site', 'outros'
  strategy text, -- Estratégia específica do canal
  content_plan jsonb DEFAULT '[]'::jsonb, -- Array de posts/mensagens/ações planejadas
  tone_of_voice text, -- Tom de voz específico para esse canal
  schedule jsonb DEFAULT '[]'::jsonb, -- Cronograma dia-a-dia [{date, action, description, status}]
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Checklist de tarefas de execução
CREATE TABLE public.campaign_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.campaign_channels(id) ON DELETE CASCADE, -- Pode ser null para tarefas gerais
  title text NOT NULL,
  description text,
  due_date date,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'done'
  sort_order integer NOT NULL DEFAULT 0,
  assigned_to text, -- Nome do responsável (sem auth)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Leads captados pela campanha (para atribuição e landing pages)
CREATE TABLE public.campaign_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  name text,
  phone text,
  email text,
  instagram text,
  source text DEFAULT 'landing_page', -- 'landing_page', 'whatsapp', 'instagram', 'loja_fisica', 'indicacao'
  metadata jsonb DEFAULT '{}'::jsonb,
  converted boolean NOT NULL DEFAULT false,
  converted_at timestamptz,
  conversion_value numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Landing pages de captação
CREATE TABLE public.campaign_landing_pages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE, -- URL amigável: /lp/slug
  title text NOT NULL,
  description text,
  hero_image_url text,
  form_fields jsonb DEFAULT '[{"name":"name","label":"Nome","type":"text","required":true},{"name":"phone","label":"WhatsApp","type":"tel","required":true}]'::jsonb,
  thank_you_message text DEFAULT 'Obrigado! Entraremos em contato em breve.',
  whatsapp_redirect text, -- Link do grupo WhatsApp para redirecionar após cadastro
  custom_css text,
  is_active boolean NOT NULL DEFAULT true,
  views integer NOT NULL DEFAULT 0,
  submissions integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: Tudo público (sem auth neste projeto)
ALTER TABLE public.campaign_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on campaign_channels" ON public.campaign_channels FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.campaign_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on campaign_tasks" ON public.campaign_tasks FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on campaign_leads" ON public.campaign_leads FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.campaign_landing_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on campaign_landing_pages" ON public.campaign_landing_pages FOR ALL USING (true) WITH CHECK (true);
