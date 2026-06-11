CREATE TABLE public.chat_attendance_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_attendance_rules TO authenticated;
GRANT ALL ON public.chat_attendance_rules TO service_role;

ALTER TABLE public.chat_attendance_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read attendance rules"
ON public.chat_attendance_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage attendance rules"
ON public.chat_attendance_rules FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_chat_attendance_rules_updated_at
BEFORE UPDATE ON public.chat_attendance_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.chat_attendance_rules (rule_key, enabled, config) VALUES
('end_with_question', true, jsonb_build_object(
  'message', 'Sua mensagem não termina com pergunta. Que tal puxar uma resposta da cliente?',
  'min_length', 12,
  'closing_phrases', jsonb_build_array(
    'obrigada','obrigado','agradeço','pedido enviado','pedido a caminho',
    'enviado pelos correios','codigo de rastreio','até logo','até mais',
    'volte sempre','qualquer coisa estou à disposição','estou à disposição',
    'tenha um ótimo dia','boa compra','seja bem-vinda de volta','finalizado',
    'pagamento confirmado','compra concluída'
  )
)),
('workload_counters', true, jsonb_build_object(
  'show_awaiting', true,
  'show_followups', true
))
ON CONFLICT (rule_key) DO NOTHING;