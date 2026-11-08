ALTER TABLE public.support_settings DROP CONSTRAINT IF EXISTS support_settings_ship_replacement_when_check;
ALTER TABLE public.support_settings ADD CONSTRAINT support_settings_ship_replacement_when_check CHECK (ship_replacement_when IN ('on_code','on_first_scan','after_conference'));
ALTER TABLE public.support_settings ALTER COLUMN ship_replacement_when SET DEFAULT 'after_conference';
UPDATE public.support_settings SET ship_replacement_when = 'after_conference' WHERE ship_replacement_when IS DISTINCT FROM 'after_conference';
ALTER TABLE public.trocas_devolucoes ADD COLUMN IF NOT EXISTS despachada_em timestamptz;
ALTER TABLE public.trocas_devolucoes ADD COLUMN IF NOT EXISTS despachada_por uuid;
ALTER TABLE public.trocas_devolucoes ADD COLUMN IF NOT EXISTS motivo_excecao_antecipado text;