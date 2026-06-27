-- Membro único por (grupo, telefone) — a instância é só "quem reportou por último"
ALTER TABLE public.whatsapp_group_members
  DROP CONSTRAINT IF EXISTS whatsapp_group_members_unique;
ALTER TABLE public.whatsapp_group_members
  ADD CONSTRAINT whatsapp_group_members_unique UNIQUE (group_id, phone);

-- Dedup idempotente do histórico: mesma mudança (mesma versão) só entra uma vez
ALTER TABLE public.whatsapp_group_member_events
  ADD COLUMN IF NOT EXISTS source_version_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_group_member_events_dedup
  ON public.whatsapp_group_member_events (group_id, phone, event_type, source_version_id)
  WHERE source_version_id IS NOT NULL;