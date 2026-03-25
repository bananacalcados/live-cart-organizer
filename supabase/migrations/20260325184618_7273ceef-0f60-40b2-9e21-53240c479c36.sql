CREATE OR REPLACE FUNCTION public.get_customer_last_address(p_customer_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT row_to_json(r) INTO v_result
  FROM (
    SELECT cr.full_name, cr.cpf, cr.email,
           cr.cep, cr.address, cr.address_number,
           cr.complement, cr.neighborhood, cr.city, cr.state
    FROM customer_registrations cr
    JOIN orders o ON o.id = cr.order_id
    WHERE o.customer_id = p_customer_id
      AND cr.full_name IS NOT NULL
    ORDER BY cr.created_at DESC
    LIMIT 1
  ) r;

  RETURN v_result;
END;
$$;