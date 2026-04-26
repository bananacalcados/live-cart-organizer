ALTER TABLE public.automation_ai_sessions
  ADD COLUMN IF NOT EXISTS live_campaign_id uuid REFERENCES public.live_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_sessions_live_campaign
  ON public.automation_ai_sessions(live_campaign_id)
  WHERE live_campaign_id IS NOT NULL;