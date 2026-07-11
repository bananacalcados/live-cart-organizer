-- 1. Team-shared pinned conversations for the event payment cards
CREATE TABLE public.event_pinned_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL,
  event_id uuid,
  pinned_by uuid,
  pinned_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_pinned_conversations TO authenticated;
GRANT ALL ON public.event_pinned_conversations TO service_role;

ALTER TABLE public.event_pinned_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view pinned conversations"
  ON public.event_pinned_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can pin conversations"
  ON public.event_pinned_conversations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Team can update pinned conversations"
  ON public.event_pinned_conversations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Team can unpin conversations"
  ON public.event_pinned_conversations FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_event_pinned_conversations_event ON public.event_pinned_conversations (event_id);

-- 2. Optional follow-up (2nd/3rd) Meta templates configured per event, fired MANUALLY from chat.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS followup_templates jsonb NOT NULL DEFAULT '[]'::jsonb;