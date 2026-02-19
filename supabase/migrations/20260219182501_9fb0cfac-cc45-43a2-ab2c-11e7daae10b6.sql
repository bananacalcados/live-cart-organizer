
-- Add payment info columns to live_viewers
ALTER TABLE public.live_viewers 
  ADD COLUMN IF NOT EXISTS payment_platform text,
  ADD COLUMN IF NOT EXISTS payment_method text;

-- Add comment for clarity
COMMENT ON COLUMN public.live_viewers.payment_platform IS 'e.g. pagarme, appmax, mercadopago';
COMMENT ON COLUMN public.live_viewers.payment_method IS 'e.g. credit_card, pix';
