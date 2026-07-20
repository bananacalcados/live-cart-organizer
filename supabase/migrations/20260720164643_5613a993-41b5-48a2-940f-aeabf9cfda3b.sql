
CREATE TABLE public.pos_boletos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid,
  seller_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_cpf text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  address_zip text NOT NULL,
  address_street text NOT NULL,
  address_number text NOT NULL,
  address_complement text,
  address_neighborhood text NOT NULL,
  address_city text NOT NULL,
  address_state text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  description text,
  due_date date NOT NULL,
  mp_account_id uuid,
  mp_payment_id text,
  mp_boleto_url text,
  mp_barcode text,
  mp_pix_payment_id text,
  mp_pix_qr_code text,
  mp_pix_qr_base64 text,
  pdf_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','cancelled','error')),
  paid_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_boletos TO authenticated;
GRANT ALL ON public.pos_boletos TO service_role;

ALTER TABLE public.pos_boletos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage boletos"
  ON public.pos_boletos FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX idx_pos_boletos_mp_payment ON public.pos_boletos(mp_payment_id);
CREATE INDEX idx_pos_boletos_mp_pix_payment ON public.pos_boletos(mp_pix_payment_id);
CREATE INDEX idx_pos_boletos_customer_phone ON public.pos_boletos(customer_phone);
CREATE INDEX idx_pos_boletos_status ON public.pos_boletos(status);

CREATE TRIGGER update_pos_boletos_updated_at
  BEFORE UPDATE ON public.pos_boletos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies for private bucket "boletos"
CREATE POLICY "Authenticated can read boletos storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'boletos');

CREATE POLICY "Service role manages boletos storage"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'boletos') WITH CHECK (bucket_id = 'boletos');
