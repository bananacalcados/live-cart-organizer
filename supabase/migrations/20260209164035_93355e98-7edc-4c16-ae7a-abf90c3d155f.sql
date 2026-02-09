
-- Table to store multiple WhatsApp numbers with their Meta API credentials
CREATE TABLE public.whatsapp_numbers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  phone_display text NOT NULL,
  phone_number_id text NOT NULL,
  business_account_id text NOT NULL,
  access_token text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.whatsapp_numbers ENABLE ROW LEVEL SECURITY;

-- Allow all access (matches existing pattern in this project)
CREATE POLICY "Allow all access to whatsapp_numbers"
ON public.whatsapp_numbers
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_whatsapp_numbers_updated_at
BEFORE UPDATE ON public.whatsapp_numbers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Ensure only one default number
CREATE UNIQUE INDEX unique_default_whatsapp_number 
ON public.whatsapp_numbers (is_default) 
WHERE is_default = true;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_numbers;
