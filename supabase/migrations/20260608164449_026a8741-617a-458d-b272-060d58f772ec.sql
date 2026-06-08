-- ============ Prestadores de serviço (universal, cross-store) ============
CREATE TABLE public.service_providers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text,
  document text,
  provider_type text NOT NULL DEFAULT 'mototaxi', -- 'mototaxi' | 'transportadora'
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_providers TO authenticated;
GRANT SELECT ON public.service_providers TO anon;
GRANT ALL ON public.service_providers TO service_role;

ALTER TABLE public.service_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view providers" ON public.service_providers FOR SELECT USING (true);
CREATE POLICY "Authenticated manage providers" ON public.service_providers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ Pagamentos a prestadores (a baixa / pagamento) ============
CREATE TABLE public.provider_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES public.service_providers(id) ON DELETE RESTRICT,
  paid_store_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  cash_register_id uuid REFERENCES public.pos_cash_registers(id) ON DELETE SET NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  receipt_pdf_url text,
  proof_file_url text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_payments TO authenticated;
GRANT SELECT ON public.provider_payments TO anon;
GRANT ALL ON public.provider_payments TO service_role;

ALTER TABLE public.provider_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view provider payments" ON public.provider_payments FOR SELECT USING (true);
CREATE POLICY "Authenticated manage provider payments" ON public.provider_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ Corridas / custos de entrega (uma linha por entrega) ============
CREATE TABLE public.delivery_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id uuid REFERENCES public.service_providers(id) ON DELETE SET NULL,
  provider_type text NOT NULL DEFAULT 'mototaxi',
  amount numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'pos', -- 'pos_centro'|'pos_perola'|'live'|'site'|'expedition_beta'|'expedition'|'pos'
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  pos_sale_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  expedition_order_id uuid,
  customer_name text,
  notes text,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'paid'
  payment_id uuid REFERENCES public.provider_payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_costs TO authenticated;
GRANT SELECT ON public.delivery_costs TO anon;
GRANT ALL ON public.delivery_costs TO service_role;

ALTER TABLE public.delivery_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view delivery costs" ON public.delivery_costs FOR SELECT USING (true);
CREATE POLICY "Authenticated manage delivery costs" ON public.delivery_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_delivery_costs_provider ON public.delivery_costs(provider_id);
CREATE INDEX idx_delivery_costs_status ON public.delivery_costs(status);
CREATE INDEX idx_delivery_costs_payment ON public.delivery_costs(payment_id);
CREATE INDEX idx_provider_payments_provider ON public.provider_payments(provider_id);

-- ============ updated_at trigger (reusa função padrão se existir) ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_service_providers_updated BEFORE UPDATE ON public.service_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_provider_payments_updated BEFORE UPDATE ON public.provider_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_delivery_costs_updated BEFORE UPDATE ON public.delivery_costs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();