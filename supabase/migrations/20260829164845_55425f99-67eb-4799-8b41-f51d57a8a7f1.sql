CREATE TABLE IF NOT EXISTS public.livete_payment_confirmation_sent (
  order_id uuid PRIMARY KEY,
  phone text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.livete_payment_confirmation_sent TO authenticated;
GRANT ALL ON public.livete_payment_confirmation_sent TO service_role;
ALTER TABLE public.livete_payment_confirmation_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff can view confirmation sends" ON public.livete_payment_confirmation_sent FOR SELECT TO authenticated USING (true);