CREATE TABLE public.email_settings (
  category text PRIMARY KEY CHECK (category IN ('fiscal','transacional','marketing')),
  from_email text NOT NULL,
  from_name text NOT NULL,
  reply_to text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all email_settings" ON public.email_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.email_settings(category, from_email, from_name, reply_to) VALUES
 ('fiscal','fiscal@bananacalcados.com.br','Banana Calçados - Fiscal','administrativo@bananacalcados.com'),
 ('transacional','pedidos@bananacalcados.com.br','Banana Calçados','sac@bananacalcados.com.br');

CREATE TABLE public.email_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL,
  company_id uuid,
  "to" text[] NOT NULL DEFAULT '{}',
  cc text[] NOT NULL DEFAULT '{}',
  subject text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.email_send_log TO authenticated;
GRANT ALL ON public.email_send_log TO service_role;
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read email_send_log" ON public.email_send_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX email_send_log_created_idx ON public.email_send_log(created_at DESC);

CREATE TABLE public.accountant_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  nome text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accountant_recipients TO authenticated;
GRANT ALL ON public.accountant_recipients TO service_role;
ALTER TABLE public.accountant_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all accountant_recipients" ON public.accountant_recipients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.accountant_send_config (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  auto_send_enabled boolean NOT NULL DEFAULT false,
  cc_emails text[] NOT NULL DEFAULT ARRAY['administrativo@bananacalcados.com'],
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accountant_send_config TO authenticated;
GRANT ALL ON public.accountant_send_config TO service_role;
ALTER TABLE public.accountant_send_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all accountant_send_config" ON public.accountant_send_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.accountant_send_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference_month text NOT NULL CHECK (reference_month ~ '^\d{4}-\d{2}$'),
  trigger_type text NOT NULL CHECK (trigger_type IN ('auto','manual')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','sent','failed','sem_notas')),
  attempt int NOT NULL DEFAULT 1,
  recipients text[] NOT NULL DEFAULT '{}',
  cc text[] NOT NULL DEFAULT '{}',
  notes_count int NOT NULL DEFAULT 0,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_path text,
  attached boolean NOT NULL DEFAULT false,
  error text,
  email_log_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.accountant_send_history TO authenticated;
GRANT ALL ON public.accountant_send_history TO service_role;
ALTER TABLE public.accountant_send_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read accountant_send_history" ON public.accountant_send_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX accountant_send_history_company_idx ON public.accountant_send_history(company_id, created_at DESC);
-- automatic sends: at most one live/finished send per company+month
CREATE UNIQUE INDEX accountant_send_history_auto_once ON public.accountant_send_history(company_id, reference_month)
  WHERE trigger_type='auto' AND status IN ('processing','sent','sem_notas');

CREATE TABLE public.fiscal_holidays (
  date date PRIMARY KEY,
  descricao text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_holidays TO authenticated;
GRANT ALL ON public.fiscal_holidays TO service_role;
ALTER TABLE public.fiscal_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all fiscal_holidays" ON public.fiscal_holidays FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.fiscal_holidays(date, descricao) VALUES
 ('2026-01-01','Confraternização Universal'),('2026-02-16','Carnaval (segunda)'),('2026-02-17','Carnaval (terça)'),
 ('2026-04-03','Sexta-feira Santa'),('2026-04-21','Tiradentes'),('2026-05-01','Dia do Trabalho'),
 ('2026-06-04','Corpus Christi'),('2026-09-07','Independência'),('2026-10-12','Nossa Senhora Aparecida'),
 ('2026-11-02','Finados'),('2026-11-15','Proclamação da República'),('2026-11-20','Consciência Negra'),('2026-12-25','Natal'),
 ('2027-01-01','Confraternização Universal'),('2027-02-08','Carnaval (segunda)'),('2027-02-09','Carnaval (terça)'),
 ('2027-03-26','Sexta-feira Santa'),('2027-04-21','Tiradentes'),('2027-05-01','Dia do Trabalho'),
 ('2027-05-27','Corpus Christi'),('2027-09-07','Independência'),('2027-10-12','Nossa Senhora Aparecida'),
 ('2027-11-02','Finados'),('2027-11-15','Proclamação da República'),('2027-11-20','Consciência Negra'),('2027-12-25','Natal');

CREATE POLICY "admin read accountant packages" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'accountant-packages' AND public.has_role(auth.uid(),'admin'));