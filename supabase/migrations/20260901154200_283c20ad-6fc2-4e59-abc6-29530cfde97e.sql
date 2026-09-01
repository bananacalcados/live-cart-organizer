CREATE OR REPLACE FUNCTION public.ig_handle_norm(_h text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(btrim(regexp_replace(coalesce(_h,''), '^\s*@\s*', ''))), '')
$$;

CREATE INDEX IF NOT EXISTS idx_customers_ig_handle_norm
  ON public.customers (public.ig_handle_norm(instagram_handle));

CREATE OR REPLACE FUNCTION public.resolve_ig_handles(_handles text[])
RETURNS TABLE (customer_id uuid, handle text, whatsapp text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, public.ig_handle_norm(c.instagram_handle), c.whatsapp
  FROM public.customers c
  WHERE public.ig_handle_norm(c.instagram_handle) = ANY (
    SELECT public.ig_handle_norm(h) FROM unnest(coalesce(_handles, '{}'::text[])) AS h
  )
$$;

REVOKE ALL ON FUNCTION public.resolve_ig_handles(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_ig_handles(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_ig_handles(text[]) TO service_role;