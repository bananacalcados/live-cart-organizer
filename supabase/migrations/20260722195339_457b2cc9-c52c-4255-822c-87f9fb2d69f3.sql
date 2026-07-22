
ALTER TABLE public.templates_carrossel
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'pos',
  ADD COLUMN IF NOT EXISTS event_id uuid NULL REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE public.templates_carrossel
  DROP CONSTRAINT IF EXISTS templates_carrossel_whatsapp_number_id_nome_qtd_cards_key;

CREATE UNIQUE INDEX IF NOT EXISTS templates_carrossel_scope_number_nome_qtd_key
  ON public.templates_carrossel (scope, whatsapp_number_id, nome, qtd_cards);

CREATE INDEX IF NOT EXISTS templates_carrossel_scope_number_idx
  ON public.templates_carrossel (scope, whatsapp_number_id);
