DROP FUNCTION IF EXISTS public.get_next_fiscal_number(uuid, smallint, smallint, text);

CREATE OR REPLACE FUNCTION public.get_next_fiscal_number(
  p_company_id uuid,
  p_modelo smallint,
  p_serie smallint DEFAULT 1,
  p_ambiente text DEFAULT 'homologacao'
)
RETURNS TABLE(next_number bigint, out_serie smallint, out_modelo smallint, out_ambiente text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_key BIGINT;
  v_next BIGINT;
BEGIN
  v_lock_key := hashtextextended(p_company_id::text || ':' || p_modelo::text || ':' || p_serie::text || ':' || p_ambiente, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  INSERT INTO public.fiscal_sequences AS fs (company_id, modelo, serie, ambiente, last_number)
  VALUES (p_company_id, p_modelo, p_serie, p_ambiente, 1)
  ON CONFLICT (company_id, modelo, serie, ambiente)
  DO UPDATE SET last_number = fs.last_number + 1,
                updated_at = now()
  RETURNING fs.last_number INTO v_next;

  RETURN QUERY SELECT v_next, p_serie, p_modelo, p_ambiente;
END;
$function$;