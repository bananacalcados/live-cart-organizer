ALTER TABLE public.live_campaign_dispatches
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_live_dispatches_number ON public.live_campaign_dispatches(whatsapp_number_id);