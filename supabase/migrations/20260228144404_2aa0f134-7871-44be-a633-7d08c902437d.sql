
-- Create table for configurable finish reasons
CREATE TABLE public.chat_finish_reasons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  icon TEXT DEFAULT 'circle',
  color TEXT DEFAULT 'text-muted-foreground border-muted',
  sort_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_finish_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read finish reasons"
ON public.chat_finish_reasons FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage finish reasons"
ON public.chat_finish_reasons FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Insert default system reasons
INSERT INTO public.chat_finish_reasons (value, label, icon, color, sort_order, is_system) VALUES
  ('suporte', 'Suporte', 'headphones', 'text-orange-500 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/20', 1, true),
  ('duvida', 'Dúvida', 'help-circle', 'text-blue-500 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/20', 2, true),
  ('compra', 'Compra', 'shopping-bag', 'text-emerald-500 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20', 3, true),
  ('disparo_msg', 'Disparo MSG', 'send', 'text-purple-500 border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/20', 4, true);
