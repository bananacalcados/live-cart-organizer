CREATE OR REPLACE FUNCTION public.can_access_company(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
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

DROP POLICY "Authenticated users can read customer chat notes" ON public.customer_chat_notes;
DROP POLICY "Authenticated users can create customer chat notes" ON public.customer_chat_notes;
DROP POLICY "Authors and managers can update customer chat notes" ON public.customer_chat_notes;
DROP POLICY "Authors and managers can delete customer chat notes" ON public.customer_chat_notes;

ALTER TABLE public.customer_chat_notes ALTER COLUMN company_id SET NOT NULL;

CREATE POLICY "Company users can read customer chat notes"
ON public.customer_chat_notes FOR SELECT TO authenticated
USING (public.can_access_company(auth.uid(), company_id));

CREATE POLICY "Company users can create customer chat notes"
ON public.customer_chat_notes FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = author_user_id
  AND public.can_access_company(auth.uid(), company_id)
  AND EXISTS (
    SELECT 1 FROM public.pos_stores store
    WHERE store.id = store_id AND store.company_id = company_id
  )
);

CREATE POLICY "Authors and managers can update customer chat notes"
ON public.customer_chat_notes FOR UPDATE TO authenticated
USING (
  public.can_access_company(auth.uid(), company_id)
  AND (auth.uid() = author_user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
)
WITH CHECK (
  public.can_access_company(auth.uid(), company_id)
  AND (auth.uid() = author_user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
);

CREATE POLICY "Authors and managers can delete customer chat notes"
ON public.customer_chat_notes FOR DELETE TO authenticated
USING (
  public.can_access_company(auth.uid(), company_id)
  AND (auth.uid() = author_user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
);