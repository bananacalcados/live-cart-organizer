
CREATE TABLE public.live_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  comment_id text NOT NULL,
  username text NOT NULL,
  comment_text text NOT NULL,
  profile_pic_url text,
  is_order boolean DEFAULT false,
  ai_confidence numeric,
  ai_classification text,
  extracted_products jsonb,
  order_id uuid REFERENCES public.orders(id),
  source_pc text,
  raw_timestamp text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, comment_id)
);

CREATE INDEX idx_live_comments_event_id ON public.live_comments(event_id);
CREATE INDEX idx_live_comments_created_at ON public.live_comments(created_at DESC);
CREATE INDEX idx_live_comments_is_order ON public.live_comments(event_id, is_order) WHERE is_order = true;

ALTER TABLE public.live_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert" ON public.live_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated read" ON public.live_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated update" ON public.live_comments FOR UPDATE TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_comments;
