CREATE TABLE public.message_funnel_steps (
  value smallint PRIMARY KEY,
  label text NOT NULL,
  kind text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_funnel_steps TO authenticated;
GRANT ALL ON public.message_funnel_steps TO service_role;
ALTER TABLE public.message_funnel_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read steps" ON public.message_funnel_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert steps" ON public.message_funnel_steps FOR INSERT TO authenticated WITH CHECK (value > 0);
CREATE POLICY "auth update steps" ON public.message_funnel_steps FOR UPDATE TO authenticated USING (kind IS NULL) WITH CHECK (kind IS NULL);
CREATE POLICY "auth delete steps" ON public.message_funnel_steps FOR DELETE TO authenticated USING (kind IS NULL AND value > 4);
CREATE UNIQUE INDEX message_funnel_steps_kind_key ON public.message_funnel_steps (kind) WHERE kind IS NOT NULL;

INSERT INTO public.message_funnel_steps (value, label, kind, sort_order) VALUES
  (1, 'Etapa 1 — Nome e endereço', NULL, 1),
  (2, 'Etapa 2 — CPF e e-mail', NULL, 2),
  (3, 'Etapa 3 — Forma de pagamento', NULL, 3),
  (4, 'Link de pagamento', 'payment_link', 4);