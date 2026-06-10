CREATE OR REPLACE FUNCTION public.format_customer_code(seq_val bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT 'BC-' || CASE
    WHEN seq_val < 1000000 THEN lpad(seq_val::text, 6, '0')
    ELSE seq_val::text
  END;
$function$;

SELECT setval('public.customer_code_seq', 1000000, true);