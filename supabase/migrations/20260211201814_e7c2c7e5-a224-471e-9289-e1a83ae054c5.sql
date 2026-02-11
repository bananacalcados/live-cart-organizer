
-- Table to track finished conversations
CREATE TABLE public.chat_finished_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_chat_finished_phone ON public.chat_finished_conversations (phone);

ALTER TABLE public.chat_finished_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to chat_finished_conversations"
ON public.chat_finished_conversations FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_finished_conversations;
