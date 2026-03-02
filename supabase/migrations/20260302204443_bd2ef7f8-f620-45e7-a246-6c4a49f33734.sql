-- Track participant count snapshots over time for campaign analytics
CREATE TABLE public.whatsapp_group_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  participant_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.whatsapp_group_snapshots ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write
CREATE POLICY "Authenticated users can read snapshots"
  ON public.whatsapp_group_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert snapshots"
  ON public.whatsapp_group_snapshots FOR INSERT
  TO authenticated WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_group_snapshots_group_recorded 
  ON public.whatsapp_group_snapshots(group_id, recorded_at DESC);

-- Also store previous_participant_count on whatsapp_groups for delta tracking
ALTER TABLE public.whatsapp_groups 
  ADD COLUMN IF NOT EXISTS previous_participant_count INTEGER DEFAULT 0;