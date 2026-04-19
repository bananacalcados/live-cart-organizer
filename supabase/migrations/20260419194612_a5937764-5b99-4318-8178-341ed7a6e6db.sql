
-- Tabela de log de DMs enviadas para comentários da live
CREATE TABLE IF NOT EXISTS public.live_comment_dms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL,
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  meta_message_id TEXT,
  error_details TEXT,
  sent_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_comment_dms_event ON public.live_comment_dms(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_comment_dms_comment ON public.live_comment_dms(comment_id);
CREATE INDEX IF NOT EXISTS idx_live_comment_dms_username ON public.live_comment_dms(event_id, username);

ALTER TABLE public.live_comment_dms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_dms" ON public.live_comment_dms
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_dms" ON public.live_comment_dms
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "service_role_all_dms" ON public.live_comment_dms
  FOR ALL TO service_role USING (true) WITH CHECK (true);
