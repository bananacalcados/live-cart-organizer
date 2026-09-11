CREATE OR REPLACE FUNCTION public.get_conversations_multi_json(
  p_number_ids uuid[] DEFAULT NULL,
  p_dispatch_only boolean DEFAULT NULL,
  p_include_unassigned boolean DEFAULT false,
  p_limit integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.get_conversations_multi(
    p_number_ids,
    p_dispatch_only,
    p_include_unassigned,
    LEAST(GREATEST(COALESCE(p_limit, 10000), 1), 20000),
    0
  ) t;
$$;

REVOKE ALL ON FUNCTION public.get_conversations_multi_json(uuid[], boolean, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversations_multi_json(uuid[], boolean, boolean, integer) TO authenticated, service_role;