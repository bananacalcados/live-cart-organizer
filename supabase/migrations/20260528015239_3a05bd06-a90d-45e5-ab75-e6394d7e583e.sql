-- Índice composto para acelerar lookups (phone, whatsapp_number_id) ordenados
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_instance_created
  ON public.whatsapp_messages (phone, whatsapp_number_id, created_at DESC);

-- Índice apenas para incoming, usado pelo guard de envio
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_incoming_created
  ON public.whatsapp_messages (phone, created_at DESC)
  WHERE direction = 'incoming' AND whatsapp_number_id IS NOT NULL;

-- Função que retorna a instância vinculada ao telefone (última mensagem incoming)
CREATE OR REPLACE FUNCTION public.get_conversation_instance(p_phone TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH variants AS (
    SELECT DISTINCT v FROM (
      SELECT regexp_replace(p_phone, '\D', '', 'g') AS v
      UNION ALL
      SELECT CASE
        WHEN regexp_replace(p_phone, '\D', '', 'g') LIKE '55%'
             AND length(regexp_replace(p_phone, '\D', '', 'g')) >= 12
          THEN substr(regexp_replace(p_phone, '\D', '', 'g'), 3)
        ELSE '55' || regexp_replace(p_phone, '\D', '', 'g')
      END
    ) t WHERE v <> ''
  )
  SELECT whatsapp_number_id
  FROM public.whatsapp_messages
  WHERE phone IN (SELECT v FROM variants)
    AND direction = 'incoming'
    AND whatsapp_number_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_conversation_instance(TEXT) TO authenticated, anon, service_role;