CREATE TABLE IF NOT EXISTS public.pos_tracking_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_tracking_templates TO authenticated;
GRANT ALL ON public.pos_tracking_templates TO service_role;

ALTER TABLE public.pos_tracking_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage tracking templates" ON public.pos_tracking_templates;
CREATE POLICY "Staff manage tracking templates" ON public.pos_tracking_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_pos_tracking_templates()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_pos_tracking_templates ON public.pos_tracking_templates;
CREATE TRIGGER trg_touch_pos_tracking_templates BEFORE UPDATE ON public.pos_tracking_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_pos_tracking_templates();

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS tracking_url text;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS delivery_days text;

INSERT INTO public.pos_tracking_templates (name, body, is_default)
SELECT 'Rastreio padrão',
'Já geramos seu código de rastreio {{primeiro_nome}} ☺️ O ENVIO será pela *Transportadora {{transportadora}}* e o prazo de entrega é {{prazo_entrega}} dias uteis.

*O seu código de Rastreio é:* {{codigo_rastreio}}

E o link pra rastrear é esse aqui: {{link_rastreio}}

Só clicar no link acima pra ir rastreando ☺️',
 true
WHERE NOT EXISTS (SELECT 1 FROM public.pos_tracking_templates);