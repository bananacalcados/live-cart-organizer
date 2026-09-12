CREATE TABLE public.customer_chat_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  phone_suffix8 text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  note text NOT NULL,
  author_user_id uuid NOT NULL,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_chat_notes TO authenticated;
GRANT ALL ON public.customer_chat_notes TO service_role;

ALTER TABLE public.customer_chat_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read customer chat notes"
ON public.customer_chat_notes FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create customer chat notes"
ON public.customer_chat_notes FOR INSERT TO authenticated
WITH CHECK (auth.uid() = author_user_id);

CREATE POLICY "Authors and managers can update customer chat notes"
ON public.customer_chat_notes FOR UPDATE TO authenticated
USING (auth.uid() = author_user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
WITH CHECK (auth.uid() = author_user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authors and managers can delete customer chat notes"
ON public.customer_chat_notes FOR DELETE TO authenticated
USING (auth.uid() = author_user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE INDEX idx_customer_chat_notes_company_phone
ON public.customer_chat_notes (company_id, phone_suffix8, created_at DESC);

CREATE INDEX idx_customer_chat_notes_store_phone
ON public.customer_chat_notes (store_id, phone_suffix8, created_at DESC);

CREATE TRIGGER update_customer_chat_notes_updated_at
BEFORE UPDATE ON public.customer_chat_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();