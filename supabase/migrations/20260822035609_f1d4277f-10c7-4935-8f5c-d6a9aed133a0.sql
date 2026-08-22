ALTER TABLE public.campanha_envios
  ADD COLUMN IF NOT EXISTS envios_realizados integer NOT NULL DEFAULT 0;

-- Backfill: linhas que já foram enviadas ao menos uma vez
UPDATE public.campanha_envios
SET envios_realizados = 1
WHERE envios_realizados = 0
  AND (enviado_em IS NOT NULL OR message_wamid IS NOT NULL OR status IN ('enviado','entregue','lido','falhou','nao_entregavel'));