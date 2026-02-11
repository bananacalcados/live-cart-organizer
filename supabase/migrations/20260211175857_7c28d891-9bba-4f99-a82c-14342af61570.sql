
-- Junction table: which WhatsApp numbers each store can use
CREATE TABLE public.pos_store_whatsapp_numbers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  whatsapp_number_id UUID NOT NULL REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, whatsapp_number_id)
);

ALTER TABLE public.pos_store_whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pos_store_whatsapp_numbers"
  ON public.pos_store_whatsapp_numbers FOR ALL USING (true) WITH CHECK (true);
