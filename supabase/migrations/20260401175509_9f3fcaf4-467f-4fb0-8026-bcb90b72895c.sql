
CREATE TABLE public.chat_conversation_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  whatsapp_number_id UUID,
  assigned_to UUID NOT NULL,
  assigned_by UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(phone, whatsapp_number_id)
);

ALTER TABLE public.chat_conversation_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view assignments"
ON public.chat_conversation_assignments FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert assignments"
ON public.chat_conversation_assignments FOR INSERT
TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update assignments"
ON public.chat_conversation_assignments FOR UPDATE
TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete assignments"
ON public.chat_conversation_assignments FOR DELETE
TO authenticated USING (true);

CREATE TRIGGER update_chat_conversation_assignments_updated_at
BEFORE UPDATE ON public.chat_conversation_assignments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live transfer updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversation_assignments;
