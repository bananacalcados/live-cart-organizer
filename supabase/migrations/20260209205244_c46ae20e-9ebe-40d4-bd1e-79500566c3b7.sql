
-- Table to store customer registration data from public form
CREATE TABLE public.customer_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  cep TEXT NOT NULL,
  address TEXT NOT NULL,
  address_number TEXT NOT NULL,
  complement TEXT,
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  shopify_draft_order_id TEXT,
  shopify_draft_order_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customer_registrations ENABLE ROW LEVEL SECURITY;

-- Public read/write policy (customers fill this via public link)
CREATE POLICY "Allow public insert on customer_registrations"
ON public.customer_registrations
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public select on customer_registrations"
ON public.customer_registrations
FOR SELECT
USING (true);

CREATE POLICY "Allow update on customer_registrations"
ON public.customer_registrations
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_customer_registrations_updated_at
BEFORE UPDATE ON public.customer_registrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_registrations;
