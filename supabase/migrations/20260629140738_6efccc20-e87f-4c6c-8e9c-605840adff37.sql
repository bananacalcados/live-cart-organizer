CREATE TABLE public.point_payment_intents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_reference text NOT NULL UNIQUE,
  terminal_id text NOT NULL,
  amount numeric(12,2) NOT NULL,
  description text,
  mp_order_id text,
  mp_payment_id text,
  status text NOT NULL DEFAULT 'pending',
  mp_status text,
  store_id uuid,
  sale_id uuid,
  mp_account_id uuid,
  is_sandbox boolean NOT NULL DEFAULT false,
  error_message text,
  raw_response jsonb,
  created_by uuid,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.point_payment_intents TO authenticated;
GRANT ALL ON public.point_payment_intents TO service_role;

ALTER TABLE public.point_payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage point_payment_intents"
  ON public.point_payment_intents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_point_intents_status ON public.point_payment_intents (status);
CREATE INDEX idx_point_intents_order ON public.point_payment_intents (mp_order_id);
CREATE INDEX idx_point_intents_terminal ON public.point_payment_intents (terminal_id);
CREATE INDEX idx_point_intents_created_at ON public.point_payment_intents (created_at DESC);

CREATE TRIGGER update_point_intents_updated_at
  BEFORE UPDATE ON public.point_payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();