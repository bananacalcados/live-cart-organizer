CREATE OR REPLACE FUNCTION public.can_access_company(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR public.has_role(_user_id, 'manager')
    OR EXISTS (
      SELECT 1
      FROM public.pos_sellers seller
      JOIN public.pos_stores store ON store.id = seller.store_id
      WHERE seller.linked_user_id = _user_id
        AND seller.is_active = true
        AND store.company_id = _company_id
    )
$$;

REVOKE ALL ON FUNCTION public.can_access_company(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_company(uuid, uuid) TO authenticated, service_role;