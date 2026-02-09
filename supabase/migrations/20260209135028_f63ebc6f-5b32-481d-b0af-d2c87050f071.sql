
-- Table for bulk Meta template message queue
CREATE TABLE public.meta_message_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  template_params jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  scheduled_at timestamp with time zone DEFAULT now(),
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.meta_message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to meta_message_queue"
ON public.meta_message_queue
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_meta_message_queue_updated_at
BEFORE UPDATE ON public.meta_message_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_message_queue;
