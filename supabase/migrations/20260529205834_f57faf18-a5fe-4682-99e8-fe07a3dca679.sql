-- Retomar o disparo "Live-Final Maio-sexta" para os destinatários ainda pendentes.
-- Reativa o status e reseta o relógio para o orquestrador/worker processarem
-- os 4444 pendentes em lote, sem reenviar para quem já recebeu (lease + SKIP LOCKED).

-- Reseta locks expirados de volta para pending para que sejam reaproveitados
UPDATE public.dispatch_recipients
SET status = 'pending', lease_until = NULL
WHERE dispatch_id = '9b53ed62-adc4-4ece-90ee-e20623dff828'
  AND status = 'leased'
  AND attempts < 3;

-- Reativa o disparo
UPDATE public.dispatch_history
SET status = 'sending',
    started_at = now(),
    completed_at = NULL,
    processing_batch = false
WHERE id = '9b53ed62-adc4-4ece-90ee-e20623dff828';