ALTER TABLE public.live_selfservice_accesses ADD COLUMN form_draft jsonb;
COMMENT ON COLUMN public.live_selfservice_accesses.form_draft IS 'Rascunho do formulário de cadastro do autoatendimento, salvo enquanto a cliente digita; espelhado em tempo real na ficha do chat. Limpo quando o cadastro é confirmado.';
GRANT SELECT ON public.live_selfservice_accesses TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_selfservice_accesses;