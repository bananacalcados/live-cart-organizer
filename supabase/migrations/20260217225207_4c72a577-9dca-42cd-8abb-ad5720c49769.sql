
-- Live chat messages (real-time chat during live sessions)
CREATE TABLE public.live_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  viewer_name TEXT NOT NULL,
  viewer_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text', -- text, command, system
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Live viewers (lead capture)
CREATE TABLE public.live_viewers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_online BOOLEAN NOT NULL DEFAULT true,
  cart_value NUMERIC DEFAULT 0,
  messages_count INTEGER DEFAULT 0,
  UNIQUE(session_id, phone)
);

-- Enable RLS
ALTER TABLE public.live_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_viewers ENABLE ROW LEVEL SECURITY;

-- Public access for live pages (no auth required)
CREATE POLICY "Anyone can read live chat messages" ON public.live_chat_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can insert live chat messages" ON public.live_chat_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read live viewers" ON public.live_viewers FOR SELECT USING (true);
CREATE POLICY "Anyone can insert live viewers" ON public.live_viewers FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update live viewers" ON public.live_viewers FOR UPDATE USING (true);

-- Enable realtime for chat messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_viewers;

-- Index for performance
CREATE INDEX idx_live_chat_session ON public.live_chat_messages(session_id, created_at DESC);
CREATE INDEX idx_live_viewers_session ON public.live_viewers(session_id, is_online);
