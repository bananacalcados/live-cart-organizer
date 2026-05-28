
-- 1. Health check fields on whatsapp_numbers
ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_check_error TEXT;

-- 2. Per-block-per-group dispatch tracking
CREATE TABLE IF NOT EXISTS public.group_campaign_block_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_message_id UUID NOT NULL,
  message_group_id UUID,
  campaign_id UUID,
  group_db_id UUID NOT NULL,
  group_zapi_id TEXT NOT NULL,
  group_name TEXT,
  block_order INT NOT NULL DEFAULT 0,
  block_type TEXT,
  whatsapp_number_id UUID,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  attempts INT NOT NULL DEFAULT 0,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.group_campaign_block_dispatches TO authenticated;
GRANT ALL ON public.group_campaign_block_dispatches TO service_role;

ALTER TABLE public.group_campaign_block_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view block dispatches"
  ON public.group_campaign_block_dispatches FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_block_disp_scheduled ON public.group_campaign_block_dispatches(scheduled_message_id);
CREATE INDEX IF NOT EXISTS idx_block_disp_msggroup ON public.group_campaign_block_dispatches(message_group_id);
CREATE INDEX IF NOT EXISTS idx_block_disp_status ON public.group_campaign_block_dispatches(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_block_disp_group ON public.group_campaign_block_dispatches(group_db_id, block_order);

CREATE TRIGGER trg_block_disp_updated_at
  BEFORE UPDATE ON public.group_campaign_block_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
