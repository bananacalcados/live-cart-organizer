ALTER TABLE public.group_redirect_links
  ADD COLUMN IF NOT EXISTS forced_group_id uuid NULL,
  ADD COLUMN IF NOT EXISTS forced_strict boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.group_redirect_links.forced_group_id IS 'Quando definido, o link redireciona sempre para este grupo VIP específico. Null = rotação automática por capacidade.';
COMMENT ON COLUMN public.group_redirect_links.forced_strict IS 'Se true, mantém o grupo fixo mesmo cheio. Se false, cai no modo automático quando o grupo fixo lota.';