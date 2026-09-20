CREATE OR REPLACE FUNCTION public.get_sale_installment_override(p_sale_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'interest_free_installments',
      NULLIF((s.payment_details->'installment_override'->>'interest_free_installments'), '')::int,
    'max_installments',
      NULLIF((s.payment_details->'installment_override'->>'max_installments'), '')::int,
    'monthly_interest_rate',
      NULLIF((s.payment_details->'installment_override'->>'monthly_interest_rate'), '')::numeric,
    'min_installment_value',
      NULLIF((s.payment_details->'installment_override'->>'min_installment_value'), '')::numeric
  )
  FROM pos_sales s
  WHERE s.id = p_sale_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sale_installment_override(uuid) TO anon, authenticated;