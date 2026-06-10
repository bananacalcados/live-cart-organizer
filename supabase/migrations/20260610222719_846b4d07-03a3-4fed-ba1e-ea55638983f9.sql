CREATE TABLE public.whatsapp_status_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL UNIQUE,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'text',
  media_url text,
  caption text,
  text_content text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_status_posts TO authenticated;
GRANT ALL ON public.whatsapp_status_posts TO service_role;

ALTER TABLE public.whatsapp_status_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read status posts"
  ON public.whatsapp_status_posts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "service manages status posts"
  ON public.whatsapp_status_posts FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_whatsapp_status_posts_message_id ON public.whatsapp_status_posts(message_id);