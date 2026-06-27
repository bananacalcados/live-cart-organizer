CREATE TABLE public.whatsapp_group_member_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id text NOT NULL,
  instance_id text,
  phone text NOT NULL,
  jid text,
  activity_type text NOT NULL CHECK (activity_type IN ('poll_vote','group_message','reaction')),
  message_id text,
  content text,
  is_internal boolean NOT NULL DEFAULT false,
  customer_id uuid,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_group_member_activity TO authenticated;
GRANT ALL ON public.whatsapp_group_member_activity TO service_role;

ALTER TABLE public.whatsapp_group_member_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read group activity"
  ON public.whatsapp_group_member_activity
  FOR SELECT TO authenticated USING (true);

-- Dedup: a mesma mensagem (voto/reação/comentário) nunca conta duas vezes.
CREATE UNIQUE INDEX uq_group_activity_message
  ON public.whatsapp_group_member_activity (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX idx_group_activity_group_phone
  ON public.whatsapp_group_member_activity (group_id, phone);

CREATE INDEX idx_group_activity_created
  ON public.whatsapp_group_member_activity (created_at DESC);

CREATE OR REPLACE FUNCTION public.get_group_member_activity(p_group_id text)
RETURNS TABLE (
  phone text,
  poll_votes bigint,
  messages bigint,
  reactions bigint,
  total bigint,
  last_activity_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    phone,
    count(*) FILTER (WHERE activity_type = 'poll_vote')      AS poll_votes,
    count(*) FILTER (WHERE activity_type = 'group_message')  AS messages,
    count(*) FILTER (WHERE activity_type = 'reaction')       AS reactions,
    count(*)                                                 AS total,
    max(created_at)                                          AS last_activity_at
  FROM public.whatsapp_group_member_activity
  WHERE group_id = regexp_replace(p_group_id, '\D', '', 'g')
  GROUP BY phone
$$;

GRANT EXECUTE ON FUNCTION public.get_group_member_activity(text) TO authenticated, service_role;