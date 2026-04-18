-- Índice para acelerar o polling do cron
CREATE INDEX IF NOT EXISTS idx_gcsm_status_scheduled 
  ON group_campaign_scheduled_messages (status, scheduled_at)
  WHERE status IN ('pending', 'sending');

-- Índice para o lookup por message_group_id (multi-bloco)
CREATE INDEX IF NOT EXISTS idx_gcsm_message_group 
  ON group_campaign_scheduled_messages (message_group_id)
  WHERE message_group_id IS NOT NULL;

-- Coluna de contagem de execuções, para detectar concorrência residual
ALTER TABLE group_campaign_scheduled_messages 
  ADD COLUMN IF NOT EXISTS execution_count INTEGER NOT NULL DEFAULT 0;

-- Coluna de última execução, para diagnóstico
ALTER TABLE group_campaign_scheduled_messages 
  ADD COLUMN IF NOT EXISTS last_execution_at TIMESTAMPTZ;

-- Função para incrementar atomicamente o contador de execuções
CREATE OR REPLACE FUNCTION increment_execution_count(message_id UUID)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE group_campaign_scheduled_messages 
  SET execution_count = execution_count + 1
  WHERE id = message_id;
$$;