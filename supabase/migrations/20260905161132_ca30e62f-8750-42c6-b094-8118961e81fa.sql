CREATE TABLE public.lead_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_field_definitions_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  CONSTRAINT lead_field_definitions_type CHECK (field_type IN ('text','number','money','cpf','phone','address','cep','yes_no','select','multiselect','date'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_field_definitions TO authenticated;
GRANT SELECT ON public.lead_field_definitions TO anon;
GRANT ALL ON public.lead_field_definitions TO service_role;

ALTER TABLE public.lead_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth manage lead_field_definitions" ON public.lead_field_definitions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public read active lead fields" ON public.lead_field_definitions
  FOR SELECT TO anon USING (is_active = true);

CREATE TRIGGER update_lead_field_definitions_updated_at
  BEFORE UPDATE ON public.lead_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.lead_field_definitions (key, label, field_type, options, required, sort_order, is_system, description) VALUES
  ('cpf', 'CPF', 'cpf', '[]', false, 10, true, 'CPF com validação de dígitos'),
  ('cep', 'CEP', 'cep', '[]', false, 20, true, 'CEP — preenche endereço automaticamente'),
  ('endereco', 'Endereço', 'address', '[]', false, 30, true, 'Rua, número e complemento'),
  ('bairro', 'Bairro', 'text', '[]', false, 35, true, NULL),
  ('cidade', 'Cidade', 'text', '[]', false, 40, true, 'Cidade onde mora'),
  ('estado', 'Estado (UF)', 'text', '[]', false, 45, true, 'Sigla do estado'),
  ('renda_mensal', 'Renda mensal', 'money', '[]', false, 50, true, 'Valor em R$'),
  ('trabalha', 'Trabalha atualmente?', 'yes_no', '[]', false, 60, true, NULL),
  ('local_trabalho', 'Local de trabalho', 'text', '[]', false, 70, true, 'Empresa / onde trabalha'),
  ('tamanho_calcado', 'Tamanho que calça', 'select',
    '[{"label":"33","value":"33"},{"label":"34","value":"34"},{"label":"35","value":"35"},{"label":"36","value":"36"},{"label":"37","value":"37"},{"label":"38","value":"38"},{"label":"39","value":"39"},{"label":"40","value":"40"},{"label":"41","value":"41"},{"label":"42","value":"42"},{"label":"43","value":"43"},{"label":"44","value":"44"}]',
    false, 80, true, 'Numeração padrão BR'),
  ('data_nascimento', 'Data de nascimento', 'date', '[]', false, 90, true, NULL)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.event_typebots
  ADD COLUMN IF NOT EXISTS notify_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_wa_number_id uuid,
  ADD COLUMN IF NOT EXISTS notify_store_id uuid,
  ADD COLUMN IF NOT EXISTS notify_message text;

ALTER TABLE public.event_leads
  ADD COLUMN IF NOT EXISTS disqualify_reason text,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notify_status text,
  ADD COLUMN IF NOT EXISTS notify_error text;

CREATE INDEX IF NOT EXISTS idx_event_leads_typebot_created ON public.event_leads (typebot_id, created_at DESC);