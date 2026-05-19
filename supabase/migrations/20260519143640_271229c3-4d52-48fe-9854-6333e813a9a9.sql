CREATE OR REPLACE FUNCTION public.list_nfe_emitters()
RETURNS TABLE (
  id uuid,
  legal_name text,
  trade_name text,
  cnpj text,
  ambiente_nfe text,
  is_active boolean,
  has_brasilnfe_token boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.legal_name, c.trade_name, c.cnpj, c.ambiente_nfe, c.is_active,
         (c.brasilnfe_token IS NOT NULL AND length(c.brasilnfe_token) > 0) AS has_brasilnfe_token
  FROM public.companies c
  WHERE c.is_active = true
    AND c.brasilnfe_token IS NOT NULL
    AND length(c.brasilnfe_token) > 0
  ORDER BY c.legal_name;
$$;

REVOKE ALL ON FUNCTION public.list_nfe_emitters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_nfe_emitters() TO authenticated;