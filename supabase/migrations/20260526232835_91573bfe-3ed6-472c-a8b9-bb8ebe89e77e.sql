
-- ============ cash_flow_entries ============
CREATE TABLE public.cash_flow_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  entry_date date NOT NULL,
  entry_datetime timestamptz NOT NULL DEFAULT now(),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  category_id uuid REFERENCES public.financial_categories(id) ON DELETE SET NULL,
  payment_method text,
  description text,
  attachment_url text,
  source text NOT NULL DEFAULT 'manual',
  external_source text,
  external_id text,
  source_ref_id text,
  pos_sale_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  bank_external_id text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending_category','confirmed','reconciled','needs_review','ignored')),
  confidence numeric(4,3),
  needs_review_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_flow_entries_external_unique UNIQUE (external_source, external_id)
);
CREATE INDEX idx_cash_flow_entries_date ON public.cash_flow_entries(entry_date DESC);
CREATE INDEX idx_cash_flow_entries_store_date ON public.cash_flow_entries(store_id, entry_date DESC);
CREATE INDEX idx_cash_flow_entries_status ON public.cash_flow_entries(status);
CREATE INDEX idx_cash_flow_entries_pos_sale ON public.cash_flow_entries(pos_sale_id);
CREATE INDEX idx_cash_flow_entries_match ON public.cash_flow_entries(direction, amount, entry_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_flow_entries TO authenticated;
GRANT ALL ON public.cash_flow_entries TO service_role;
ALTER TABLE public.cash_flow_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cash flow" ON public.cash_flow_entries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_cash_flow_entries_updated
BEFORE UPDATE ON public.cash_flow_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ bank_import_batches ============
CREATE TABLE public.bank_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_hash text NOT NULL,
  source_type text NOT NULL,
  rows_total int NOT NULL DEFAULT 0,
  rows_inserted int NOT NULL DEFAULT 0,
  rows_duplicated int NOT NULL DEFAULT 0,
  rows_matched int NOT NULL DEFAULT 0,
  rows_needs_review int NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_via text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_hash, source_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_import_batches TO authenticated;
GRANT ALL ON public.bank_import_batches TO service_role;
ALTER TABLE public.bank_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage import batches" ON public.bank_import_batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- ============ payment_method_fees ============
CREATE TABLE public.payment_method_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acquirer text NOT NULL DEFAULT 'mercadopago',
  method text NOT NULL,
  brand text,
  installments int NOT NULL DEFAULT 1,
  fee_pct numeric(6,4) NOT NULL DEFAULT 0,
  fixed_fee numeric(10,2) NOT NULL DEFAULT 0,
  days_to_receive int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (acquirer, method, brand, installments)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_method_fees TO authenticated;
GRANT ALL ON public.payment_method_fees TO service_role;
ALTER TABLE public.payment_method_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage fees" ON public.payment_method_fees FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_payment_method_fees_updated
BEFORE UPDATE ON public.payment_method_fees
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ financial_agent_authorized_users ============
CREATE TABLE public.financial_agent_authorized_users (
  chat_id bigint PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text,
  role text NOT NULL DEFAULT 'admin',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_agent_authorized_users TO authenticated;
GRANT ALL ON public.financial_agent_authorized_users TO service_role;
ALTER TABLE public.financial_agent_authorized_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage agent users" ON public.financial_agent_authorized_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- ============ financial_agent_sessions ============
CREATE TABLE public.financial_agent_sessions (
  chat_id bigint PRIMARY KEY,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_attachment jsonb,
  expected_action text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_agent_sessions TO authenticated;
GRANT ALL ON public.financial_agent_sessions TO service_role;
ALTER TABLE public.financial_agent_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read agent sessions" ON public.financial_agent_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

-- ============ financial_agent_audit ============
CREATE TABLE public.financial_agent_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint,
  direction text NOT NULL CHECK (direction IN ('in','out','system')),
  action text,
  message text,
  attachment_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_agent_audit_chat ON public.financial_agent_audit(chat_id, created_at DESC);
GRANT SELECT, INSERT ON public.financial_agent_audit TO authenticated;
GRANT ALL ON public.financial_agent_audit TO service_role;
ALTER TABLE public.financial_agent_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read agent audit" ON public.financial_agent_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

-- ============ financial_agent_invite_tokens ============
CREATE TABLE public.financial_agent_invite_tokens (
  token text PRIMARY KEY,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_by_chat_id bigint,
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_agent_invite_tokens TO authenticated;
GRANT ALL ON public.financial_agent_invite_tokens TO service_role;
ALTER TABLE public.financial_agent_invite_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage invite tokens" ON public.financial_agent_invite_tokens FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- ============ Storage bucket ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('financial-receipts','financial-receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read financial receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'financial-receipts' AND public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins upload financial receipts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'financial-receipts' AND public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins update financial receipts" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'financial-receipts' AND public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins delete financial receipts" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'financial-receipts' AND public.has_role(auth.uid(),'admin'::app_role));
