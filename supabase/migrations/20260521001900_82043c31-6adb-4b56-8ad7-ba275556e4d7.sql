
-- 1) Adiciona coluna source (com DEFAULT — não quebra nenhum INSERT existente)
ALTER TABLE public.whatsapp_messages 
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.whatsapp_messages_archive 
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- 2) Índice parcial para acelerar varredura de broadcast/ads inativos
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_source_created
  ON public.whatsapp_messages (source, created_at)
  WHERE source IN ('broadcast', 'ads_lead');

-- 3) Função: arquiva broadcasts sem resposta (>15d por padrão)
-- Critério: TODAS as mensagens do telefone são outgoing source='broadcast',
-- última atividade > p_days, e sem pedido ativo / ticket aberto.
CREATE OR REPLACE FUNCTION public.archive_inactive_broadcast_messages(
  p_days integer DEFAULT 15,
  p_batch_size integer DEFAULT 5000
)
RETURNS TABLE(archived_phones integer, archived_messages integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_phones text[];
  v_msgs_count integer := 0;
BEGIN
  -- Seleciona telefones cujas conversas são SÓ broadcasts sem resposta
  SELECT array_agg(phone) INTO v_phones
  FROM (
    SELECT phone
    FROM public.whatsapp_messages
    GROUP BY phone
    HAVING MAX(created_at) < v_cutoff
       AND bool_and(direction = 'outgoing' AND source = 'broadcast')
       AND COUNT(*) > 0
    LIMIT p_batch_size
  ) sub
  WHERE phone NOT IN (
    -- Excluir telefones com pedido ativo
    SELECT DISTINCT regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')
    FROM public.customers c
    JOIN public.orders o ON o.customer_id = c.id
    WHERE o.stage NOT IN ('delivered', 'cancelled', 'refunded')
      AND coalesce(whatsapp, '') <> ''
  );

  IF v_phones IS NULL OR array_length(v_phones, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Move mensagens para o arquivo
  WITH moved AS (
    DELETE FROM public.whatsapp_messages
    WHERE phone = ANY(v_phones)
    RETURNING *
  )
  INSERT INTO public.whatsapp_messages_archive
  SELECT * FROM moved
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_msgs_count = ROW_COUNT;
  RETURN QUERY SELECT array_length(v_phones, 1), v_msgs_count;
END;
$$;

-- 4) Função: arquiva leads de Ads inativos (>30d por padrão)
-- Critério: existe alguma mensagem source='ads_lead' OU referral.ctwa_clid,
-- última atividade > p_days, sem pedido ativo / ticket aberto.
CREATE OR REPLACE FUNCTION public.archive_inactive_ads_conversations(
  p_days integer DEFAULT 30,
  p_batch_size integer DEFAULT 5000
)
RETURNS TABLE(archived_phones integer, archived_messages integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_phones text[];
  v_msgs_count integer := 0;
BEGIN
  SELECT array_agg(phone) INTO v_phones
  FROM (
    SELECT phone
    FROM public.whatsapp_messages
    GROUP BY phone
    HAVING MAX(created_at) < v_cutoff
       AND bool_or(
         source = 'ads_lead'
         OR (referral IS NOT NULL AND referral ? 'ctwa_clid')
       )
    LIMIT p_batch_size
  ) sub
  WHERE phone NOT IN (
    SELECT DISTINCT regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')
    FROM public.customers c
    JOIN public.orders o ON o.customer_id = c.id
    WHERE o.stage NOT IN ('delivered', 'cancelled', 'refunded')
      AND coalesce(whatsapp, '') <> ''
  );

  IF v_phones IS NULL OR array_length(v_phones, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  WITH moved AS (
    DELETE FROM public.whatsapp_messages
    WHERE phone = ANY(v_phones)
    RETURNING *
  )
  INSERT INTO public.whatsapp_messages_archive
  SELECT * FROM moved
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_msgs_count = ROW_COUNT;
  RETURN QUERY SELECT array_length(v_phones, 1), v_msgs_count;
END;
$$;

-- 5) Cron jobs noturnos
SELECT cron.unschedule('archive-broadcast-inactive-nightly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'archive-broadcast-inactive-nightly'
);
SELECT cron.unschedule('archive-ads-inactive-nightly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'archive-ads-inactive-nightly'
);

SELECT cron.schedule(
  'archive-broadcast-inactive-nightly',
  '45 3 * * *',
  $$ SELECT public.archive_inactive_broadcast_messages(15, 5000); $$
);

SELECT cron.schedule(
  'archive-ads-inactive-nightly',
  '0 4 * * *',
  $$ SELECT public.archive_inactive_ads_conversations(30, 5000); $$
);
