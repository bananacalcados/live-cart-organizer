
-- 1B: sender_user_id on whatsapp_messages
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS sender_user_id uuid DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_wm_sender_user_id ON whatsapp_messages (sender_user_id) WHERE sender_user_id IS NOT NULL;

-- 1C: tags on ad_leads
ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_ad_leads_tags ON ad_leads USING GIN (tags);

-- 1D: Sync trigger chat_contacts → ad_leads
CREATE OR REPLACE FUNCTION public.sync_contact_tags_to_leads()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.tags IS DISTINCT FROM NEW.tags THEN
    UPDATE ad_leads SET tags = NEW.tags, updated_at = now()
    WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = right(regexp_replace(NEW.phone, '[^0-9]', '', 'g'), 8);

    IF NOT FOUND THEN
      INSERT INTO ad_leads (phone, name, tags, source, channel)
      VALUES (NEW.phone, COALESCE(NEW.custom_name, NEW.display_name), NEW.tags, 'organic_whatsapp', 'zapi');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

DROP TRIGGER IF EXISTS trigger_sync_contact_tags ON chat_contacts;
CREATE TRIGGER trigger_sync_contact_tags
AFTER UPDATE OF tags ON chat_contacts
FOR EACH ROW
EXECUTE FUNCTION public.sync_contact_tags_to_leads();

-- 1E: Auto-reply tables
CREATE TABLE IF NOT EXISTS whatsapp_auto_replies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp_number_id uuid REFERENCES whatsapp_numbers(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('welcome', 'away')),
  message text NOT NULL,
  is_active boolean DEFAULT true,
  schedule_start time DEFAULT NULL,
  schedule_end time DEFAULT NULL,
  schedule_days integer[] DEFAULT '{0,1,2,3,4,5,6}',
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(whatsapp_number_id, type)
);

ALTER TABLE whatsapp_auto_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access whatsapp_auto_replies" ON whatsapp_auto_replies
  TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS whatsapp_auto_reply_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  whatsapp_number_id uuid REFERENCES whatsapp_numbers(id),
  type text NOT NULL CHECK (type IN ('welcome', 'away')),
  sent_at timestamptz DEFAULT now()
);

ALTER TABLE whatsapp_auto_reply_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access whatsapp_auto_reply_log" ON whatsapp_auto_reply_log
  TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_auto_reply_log_lookup 
ON whatsapp_auto_reply_log (phone, whatsapp_number_id, type, sent_at);

-- 1G: Attendant metrics RPC
CREATE OR REPLACE FUNCTION public.get_attendant_metrics(
  p_user_id uuid DEFAULT NULL,
  p_start_date timestamptz DEFAULT (now() - interval '30 days'),
  p_end_date timestamptz DEFAULT now()
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  total_conversations bigint,
  active_conversations bigint,
  finished_conversations bigint,
  total_messages_sent bigint,
  total_messages_received bigint,
  avg_first_response_minutes numeric,
  conversations_today bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH attendant_convos AS (
    SELECT DISTINCT ON (cca.phone)
      cca.assigned_to AS uid,
      cca.phone,
      cca.created_at AS assigned_at
    FROM chat_conversation_assignments cca
    WHERE cca.created_at >= p_start_date
      AND cca.created_at <= p_end_date
      AND (p_user_id IS NULL OR cca.assigned_to = p_user_id)
    ORDER BY cca.phone, cca.created_at DESC
  ),
  finished AS (
    SELECT DISTINCT ON (cfc.phone) cfc.phone, cfc.finished_at
    FROM chat_finished_conversations cfc
    WHERE cfc.finished_at >= p_start_date
    ORDER BY cfc.phone, cfc.finished_at DESC
  ),
  msg_counts AS (
    SELECT
      ac.uid,
      COUNT(wm.id) FILTER (WHERE wm.direction = 'outgoing' AND wm.sender_user_id = ac.uid) AS sent,
      COUNT(wm.id) FILTER (WHERE wm.direction = 'incoming') AS received
    FROM attendant_convos ac
    JOIN whatsapp_messages wm ON wm.phone = ac.phone
      AND wm.created_at >= p_start_date AND wm.created_at <= p_end_date
    GROUP BY ac.uid
  ),
  first_responses AS (
    SELECT
      ac.uid,
      ac.phone,
      MIN(wm.created_at) FILTER (WHERE wm.direction = 'incoming') AS first_in,
      MIN(wm.created_at) FILTER (WHERE wm.direction = 'outgoing' AND wm.sender_user_id = ac.uid) AS first_out
    FROM attendant_convos ac
    JOIN whatsapp_messages wm ON wm.phone = ac.phone
      AND wm.created_at >= ac.assigned_at
    GROUP BY ac.uid, ac.phone
  )
  SELECT
    p.user_id,
    p.display_name,
    COUNT(DISTINCT ac.phone)::bigint AS total_conversations,
    COUNT(DISTINCT ac.phone) FILTER (WHERE f.phone IS NULL)::bigint AS active_conversations,
    COUNT(DISTINCT ac.phone) FILTER (WHERE f.phone IS NOT NULL)::bigint AS finished_conversations,
    COALESCE(MAX(mc.sent), 0)::bigint AS total_messages_sent,
    COALESCE(MAX(mc.received), 0)::bigint AS total_messages_received,
    ROUND(AVG(EXTRACT(EPOCH FROM (fr.first_out - fr.first_in)) / 60.0) FILTER (WHERE fr.first_out > fr.first_in), 1) AS avg_first_response_minutes,
    COUNT(DISTINCT ac.phone) FILTER (WHERE ac.assigned_at::date = CURRENT_DATE)::bigint AS conversations_today
  FROM profiles p
  LEFT JOIN attendant_convos ac ON ac.uid = p.user_id
  LEFT JOIN finished f ON f.phone = ac.phone AND f.finished_at > ac.assigned_at
  LEFT JOIN msg_counts mc ON mc.uid = p.user_id
  LEFT JOIN first_responses fr ON fr.uid = p.user_id AND fr.phone = ac.phone
  WHERE (p_user_id IS NULL OR p.user_id = p_user_id)
  GROUP BY p.user_id, p.display_name;
END;
$$;
