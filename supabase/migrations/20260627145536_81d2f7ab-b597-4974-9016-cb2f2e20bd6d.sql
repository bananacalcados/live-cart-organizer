-- Substitui o índice parcial (não utilizável por upsert onConflict) por uma
-- constraint de unicidade real. source_version_id passa a ter default '' para
-- nunca ser nulo e permitir inferência de conflito.
DROP INDEX IF EXISTS uq_wa_group_member_events_dedup;

UPDATE public.whatsapp_group_member_events SET source_version_id = '' WHERE source_version_id IS NULL;

ALTER TABLE public.whatsapp_group_member_events
  ALTER COLUMN source_version_id SET DEFAULT '',
  ALTER COLUMN source_version_id SET NOT NULL;

ALTER TABLE public.whatsapp_group_member_events
  ADD CONSTRAINT uq_wa_group_member_events_dedup
  UNIQUE (group_id, phone, event_type, source_version_id);