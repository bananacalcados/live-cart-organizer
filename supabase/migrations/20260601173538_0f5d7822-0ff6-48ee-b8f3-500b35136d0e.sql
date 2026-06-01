CREATE TABLE public.blocked_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  provider text,
  reason text,
  blocked_by uuid,
  blocked_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone, whatsapp_number_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_contacts TO authenticated;
GRANT ALL ON public.blocked_contacts TO service_role;

ALTER TABLE public.blocked_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read blocked_contacts"
  ON public.blocked_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert blocked_contacts"
  ON public.blocked_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update blocked_contacts"
  ON public.blocked_contacts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "authenticated delete blocked_contacts"
  ON public.blocked_contacts FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_blocked_contacts_phone ON public.blocked_contacts (phone);