
-- 1. Archive table mirrors whatsapp_messages structure, minimal indexes, no realtime
CREATE TABLE IF NOT EXISTS public.whatsapp_messages_archive (
  id uuid PRIMARY KEY,
  phone varchar NOT NULL,
  message text NOT NULL,
  direction varchar NOT NULL,
  message_id text,
  status varchar,
  created_at timestamptz NOT NULL,
  media_type varchar,
  media_url text,
  is_group boolean DEFAULT false,
  whatsapp_number_id uuid,
  sender_name text,
  error_code text,
  error_message text,
  channel text NOT NULL DEFAULT 'whatsapp',
  is_mass_dispatch boolean NOT NULL DEFAULT false,
  referral jsonb,
  sender_user_id uuid,
  quoted_message_id text,
  archived_at timestamptz NOT NULL DEFAULT now()
);

-- Minimal indexes: only what the chat UI needs to fetch old history for one phone
CREATE INDEX IF NOT EXISTS idx_wm_archive_phone_created
  ON public.whatsapp_messages_archive (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wm_archive_created_at
  ON public.whatsapp_messages_archive (created_at);

-- Enable RLS, mirror policies of the main table (read-only for authenticated users)
ALTER TABLE public.whatsapp_messages_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read archive" ON public.whatsapp_messages_archive;
CREATE POLICY "Authenticated can read archive"
  ON public.whatsapp_messages_archive
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. Archival function: move rows older than 90 days, in batches
CREATE OR REPLACE FUNCTION public.archive_old_whatsapp_messages(p_batch_size int DEFAULT 5000)
RETURNS TABLE(moved_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_moved int := 0;
BEGIN
  WITH to_move AS (
    SELECT id
    FROM public.whatsapp_messages
    WHERE created_at < now() - interval '90 days'
    ORDER BY created_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  moved AS (
    DELETE FROM public.whatsapp_messages w
    USING to_move
    WHERE w.id = to_move.id
    RETURNING w.*
  )
  INSERT INTO public.whatsapp_messages_archive (
    id, phone, message, direction, message_id, status, created_at,
    media_type, media_url, is_group, whatsapp_number_id, sender_name,
    error_code, error_message, channel, is_mass_dispatch, referral,
    sender_user_id, quoted_message_id
  )
  SELECT
    id, phone, message, direction, message_id, status, created_at,
    media_type, media_url, is_group, whatsapp_number_id, sender_name,
    error_code, error_message, channel, is_mass_dispatch, referral,
    sender_user_id, quoted_message_id
  FROM moved
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  moved_count := v_moved;
  RETURN NEXT;
END;
$$;

-- 3. Unified view: chat reads "last N messages of a phone" from both tables transparently
CREATE OR REPLACE VIEW public.whatsapp_messages_unified AS
SELECT id, phone, message, direction, message_id, status, created_at,
       media_type, media_url, is_group, whatsapp_number_id, sender_name,
       error_code, error_message, channel, is_mass_dispatch, referral,
       sender_user_id, quoted_message_id, false AS is_archived
FROM public.whatsapp_messages
UNION ALL
SELECT id, phone, message, direction, message_id, status, created_at,
       media_type, media_url, is_group, whatsapp_number_id, sender_name,
       error_code, error_message, channel, is_mass_dispatch, referral,
       sender_user_id, quoted_message_id, true AS is_archived
FROM public.whatsapp_messages_archive;
