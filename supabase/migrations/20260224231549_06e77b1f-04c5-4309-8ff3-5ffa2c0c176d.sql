
-- Table for team chat read receipts
CREATE TABLE public.team_chat_reads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.team_chat_messages(id) ON DELETE CASCADE,
  reader_name TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id, reader_name)
);

-- Enable RLS
ALTER TABLE public.team_chat_reads ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (team chat is internal)
CREATE POLICY "Authenticated users can read team_chat_reads"
  ON public.team_chat_reads FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert team_chat_reads"
  ON public.team_chat_reads FOR INSERT
  TO authenticated WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_chat_reads;
