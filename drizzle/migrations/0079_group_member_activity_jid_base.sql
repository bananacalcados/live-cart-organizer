-- Atividade de membros passa a filtrar pelo ID normalizado (group_jid_base).
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
  WHERE group_jid_base = split_part(split_part(p_group_id, '@', 1), '-', 1)
  GROUP BY phone
$$;

GRANT EXECUTE ON FUNCTION public.get_group_member_activity(text) TO authenticated, service_role;