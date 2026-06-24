-- Etapa 1: Escada de templates de carrossel (config gerida pelo admin)
CREATE TABLE public.templates_carrossel (
  qtd_cards integer PRIMARY KEY CHECK (qtd_cards >= 2 AND qtd_cards <= 10),
  template_id text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  aprovado boolean NOT NULL DEFAULT false,
  meta_status text NOT NULL DEFAULT 'PENDING',
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates_carrossel TO authenticated;
GRANT ALL ON public.templates_carrossel TO service_role;

ALTER TABLE public.templates_carrossel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read carousel templates ladder"
  ON public.templates_carrossel FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage carousel templates ladder"
  ON public.templates_carrossel FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT ALL ON public.templates_carrossel TO service_role;

CREATE TRIGGER update_templates_carrossel_updated_at
  BEFORE UPDATE ON public.templates_carrossel
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();