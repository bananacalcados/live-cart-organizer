
-- Table for live commerce sessions
CREATE TABLE public.live_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  youtube_video_id TEXT,
  whatsapp_link TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  selected_products JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;

-- Public read for the active live (customers need to see it)
CREATE POLICY "Anyone can view active live sessions"
  ON public.live_sessions FOR SELECT
  USING (is_active = true);

-- Authenticated users can manage
CREATE POLICY "Authenticated users can manage live sessions"
  ON public.live_sessions FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_live_sessions_updated_at
  BEFORE UPDATE ON public.live_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
