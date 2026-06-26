ALTER TABLE public.campanha_envios DROP CONSTRAINT IF EXISTS campanha_envios_status_check;
ALTER TABLE public.campanha_envios ADD CONSTRAINT campanha_envios_status_check
  CHECK (status = ANY (ARRAY['pendente'::text, 'enviado'::text, 'entregue'::text, 'lido'::text, 'falhou'::text, 'capped'::text, 'nao_entregavel'::text]));