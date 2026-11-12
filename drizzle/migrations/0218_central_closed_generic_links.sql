CREATE OR REPLACE FUNCTION public.central_link_access(p_hash text,p_type text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN l.is_test THEN 'test' ELSE 'real' END
  FROM public.support_links l
  WHERE l.token_hash=p_hash AND l.request_type=p_type AND l.revoked_at IS NULL AND l.expires_at>now()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.central_link_access(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_link_access(text,text) TO service_role;