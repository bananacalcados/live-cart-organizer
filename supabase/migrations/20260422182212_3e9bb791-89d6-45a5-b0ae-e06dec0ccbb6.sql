-- Tabela para vincular @username do Instagram ao IG-scoped user ID (necessário para enviar DMs)
CREATE TABLE IF NOT EXISTS public.instagram_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  ig_user_id text NOT NULL,
  source text NOT NULL DEFAULT 'webhook', -- 'webhook' | 'private_reply' | 'manual'
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_links_username ON public.instagram_user_links (lower(username));
CREATE INDEX IF NOT EXISTS idx_ig_links_user_id ON public.instagram_user_links (ig_user_id);

ALTER TABLE public.instagram_user_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_ig_links" ON public.instagram_user_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_ig_links" ON public.instagram_user_links FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_ig_links" ON public.instagram_user_links FOR UPDATE TO authenticated USING (true);
CREATE POLICY "service_role_all_ig_links" ON public.instagram_user_links TO service_role USING (true) WITH CHECK (true);

-- Backfill: aproveitar dados que já temos em whatsapp_messages (sender_name = @username, phone = ig_user_id)
INSERT INTO public.instagram_user_links (username, ig_user_id, source, last_seen_at)
SELECT DISTINCT ON (lower(regexp_replace(sender_name, '^@', '')))
  regexp_replace(sender_name, '^@', '') as username,
  phone as ig_user_id,
  'webhook' as source,
  MAX(created_at) as last_seen_at
FROM public.whatsapp_messages
WHERE channel = 'instagram'
  AND sender_name IS NOT NULL
  AND sender_name LIKE '@%'
  AND phone ~ '^[0-9]+$'
GROUP BY lower(regexp_replace(sender_name, '^@', '')), regexp_replace(sender_name, '^@', ''), phone
ORDER BY lower(regexp_replace(sender_name, '^@', '')), MAX(created_at) DESC
ON CONFLICT (lower(username)) DO NOTHING;

-- Tabela para tracking de quem leu qual conversa (para badge "não lidas")
CREATE TABLE IF NOT EXISTS public.instagram_dm_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, username)
);

CREATE INDEX IF NOT EXISTS idx_ig_dm_reads_user ON public.instagram_dm_reads (user_id);

ALTER TABLE public.instagram_dm_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_reads" ON public.instagram_dm_reads FOR ALL TO authenticated 
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "service_role_all_dm_reads" ON public.instagram_dm_reads TO service_role USING (true) WITH CHECK (true);