CREATE TABLE public.instagram_customer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_user_id text NOT NULL,
  username_norm text,
  phone text,
  customer_id uuid,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','rejected')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instagram_customer_links_uq ON public.instagram_customer_links (ig_user_id, coalesce(phone,''));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instagram_customer_links TO authenticated;
GRANT ALL ON public.instagram_customer_links TO service_role;
ALTER TABLE public.instagram_customer_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe gerencia vínculos IG" ON public.instagram_customer_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.resolve_instagram_customer(p_username text, p_ig_user_id text)
RETURNS TABLE(phone text, name text, instagram text, source text, confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (SELECT public.ig_handle_norm(p_username) AS h),
  rejected AS (
    SELECT l.phone FROM public.instagram_customer_links l
    WHERE l.ig_user_id = p_ig_user_id AND l.status = 'rejected'
  ),
  confirmed AS (
    SELECT l.phone, NULL::text AS name, l.username_norm AS instagram, 'vinculo'::text AS source, true AS confirmed
    FROM public.instagram_customer_links l
    WHERE l.ig_user_id = p_ig_user_id AND l.status = 'confirmed' AND l.phone IS NOT NULL
    LIMIT 1
  ),
  by_live AS (
    SELECT c.whatsapp AS phone, c.full_name AS name, c.instagram_handle AS instagram, 'live'::text, false
    FROM public.customers c, u
    WHERE u.h IS NOT NULL AND public.ig_handle_norm(c.instagram_handle) = u.h
      AND coalesce(c.whatsapp,'') <> ''
    LIMIT 5
  ),
  by_unified AS (
    SELECT cu.phone_e164, cu.name, cu.instagram_handle, 'crm'::text, false
    FROM public.customers_unified cu, u
    WHERE u.h IS NOT NULL AND lower(cu.instagram_handle) IN (u.h, '@' || u.h)
      AND coalesce(cu.phone_e164,'') <> ''
    LIMIT 5
  )
  SELECT * FROM confirmed
  UNION ALL
  SELECT * FROM (
    SELECT DISTINCT ON (right(regexp_replace(x.phone,'\D','','g'),8)) x.*
    FROM (SELECT * FROM by_live UNION ALL SELECT * FROM by_unified) x
    WHERE NOT EXISTS (SELECT 1 FROM confirmed)
      AND right(regexp_replace(x.phone,'\D','','g'),8) NOT IN (
        SELECT right(regexp_replace(r.phone,'\D','','g'),8) FROM rejected r WHERE r.phone IS NOT NULL)
    LIMIT 5
  ) s;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_instagram_customer(text, text) TO authenticated;