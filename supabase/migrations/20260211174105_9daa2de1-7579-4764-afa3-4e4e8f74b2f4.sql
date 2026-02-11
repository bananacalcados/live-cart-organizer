
-- Add column to store which payment methods trigger auto NFC-e emission
ALTER TABLE public.pos_invoice_config 
ADD COLUMN IF NOT EXISTS auto_emit_payment_methods text[] DEFAULT '{}';

-- Comment for clarity
COMMENT ON COLUMN public.pos_invoice_config.auto_emit_payment_methods IS 'List of payment method types that trigger automatic NFC-e emission. E.g. pix, credito, debito';
