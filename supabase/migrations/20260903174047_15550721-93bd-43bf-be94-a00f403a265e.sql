CREATE OR REPLACE FUNCTION public.ig_handle_loose(_h text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(coalesce(public.ig_handle_norm(_h),''), '[._\s]', '', 'g'), '')
$$;

CREATE INDEX IF NOT EXISTS idx_customers_ig_handle_loose
  ON public.customers (public.ig_handle_loose(instagram_handle))
  WHERE instagram_handle IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_ig_handles(_handles text[])
RETURNS TABLE(customer_id uuid, handle text, whatsapp text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH req AS (
    SELECT DISTINCT public.ig_handle_norm(h) AS h
    FROM unnest(coalesce(_handles, '{}'::text[])) AS h
    WHERE public.ig_handle_norm(h) IS NOT NULL
  ),
  exact AS (
    SELECT c.id AS customer_id, r.h AS handle, c.whatsapp, c.updated_at
    FROM req r
    JOIN public.customers c ON public.ig_handle_norm(c.instagram_handle) = r.h
  ),
  loose AS (
    SELECT c.id AS customer_id, r.h AS handle, c.whatsapp, c.updated_at
    FROM req r
    JOIN public.customers c ON public.ig_handle_loose(c.instagram_handle) = public.ig_handle_loose(r.h)
    WHERE NOT EXISTS (SELECT 1 FROM exact e WHERE e.handle = r.h)
  ),
  allm AS (
    SELECT * FROM exact
    UNION ALL
    SELECT * FROM loose
  )
  SELECT DISTINCT ON (handle) customer_id, handle, whatsapp
  FROM allm
  ORDER BY handle, (whatsapp IS NOT NULL) DESC, updated_at DESC NULLS LAST
$$;

REVOKE ALL ON FUNCTION public.resolve_ig_handles(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_ig_handles(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_ig_handles(text[]) TO service_role;