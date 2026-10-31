ALTER TABLE public.live_catalog_links ADD COLUMN last_opened_at timestamptz;
CREATE OR REPLACE FUNCTION public.live_catalog_staff_link_last_open(p_link_id uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(last_opened_at, opened_at) FROM live_catalog_links WHERE id=p_link_id AND has_module_access(auth.uid(),'events');
$$;
REVOKE ALL ON FUNCTION public.live_catalog_staff_link_last_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_catalog_staff_link_last_open(uuid) TO authenticated;