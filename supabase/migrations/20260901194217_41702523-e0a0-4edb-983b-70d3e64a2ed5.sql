CREATE TABLE IF NOT EXISTS public.event_archived_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  phone text NOT NULL,
  whatsapp_number_id uuid,
  archived_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, phone)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_archived_conversations TO authenticated;
GRANT ALL ON public.event_archived_conversations TO service_role;

ALTER TABLE public.event_archived_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth manage event archived conversations"
ON public.event_archived_conversations FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_event_archived_conv_event ON public.event_archived_conversations(event_id);