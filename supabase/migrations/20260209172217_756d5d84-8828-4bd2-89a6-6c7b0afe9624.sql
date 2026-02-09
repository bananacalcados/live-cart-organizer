
-- Add whatsapp_number_id to track which Meta number sent/received each message
ALTER TABLE public.whatsapp_messages 
ADD COLUMN whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;

-- Create index for filtering by number
CREATE INDEX idx_whatsapp_messages_number_id ON public.whatsapp_messages(whatsapp_number_id);
