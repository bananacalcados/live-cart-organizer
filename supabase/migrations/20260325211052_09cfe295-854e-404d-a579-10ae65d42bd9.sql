
CREATE OR REPLACE FUNCTION public.update_order_stage(p_order_id text, p_stage text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.orders
  SET stage_atendimento = p_stage
  WHERE id::text = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_stage(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_order_stage(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_last_address(p_customer_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT row_to_json(r) INTO v_result
  FROM (
    SELECT cr.full_name, cr.cpf, cr.email,
           cr.cep, cr.address, cr.address_number,
           cr.complement, cr.neighborhood, cr.city, cr.state
    FROM public.customer_registrations cr
    JOIN public.orders o ON o.id = cr.order_id
    WHERE o.customer_id = p_customer_id
      AND cr.full_name IS NOT NULL
    ORDER BY cr.created_at DESC
    LIMIT 1
  ) r;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_last_address(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_customer_last_address(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_customer_registration(
  p_order_id uuid,
  p_full_name text,
  p_cpf text,
  p_email text,
  p_whatsapp text,
  p_cep text,
  p_address text,
  p_address_number text,
  p_complement text DEFAULT NULL,
  p_neighborhood text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.customer_registrations (
    order_id, full_name, cpf, email, whatsapp,
    cep, address, address_number, complement,
    neighborhood, city, state, customer_id
  ) VALUES (
    p_order_id, p_full_name, p_cpf, p_email, p_whatsapp,
    p_cep, p_address, p_address_number, p_complement,
    p_neighborhood, p_city, p_state, p_customer_id
  )
  ON CONFLICT (order_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    cpf = EXCLUDED.cpf,
    email = EXCLUDED.email,
    whatsapp = EXCLUDED.whatsapp,
    cep = EXCLUDED.cep,
    address = EXCLUDED.address,
    address_number = EXCLUDED.address_number,
    complement = EXCLUDED.complement,
    neighborhood = EXCLUDED.neighborhood,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    customer_id = COALESCE(EXCLUDED.customer_id, public.customer_registrations.customer_id),
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_customer_registration(uuid, text, text, text, text, text, text, text, text, text, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.save_customer_registration(uuid, text, text, text, text, text, text, text, text, text, text, text, uuid) TO authenticated;
