CREATE OR REPLACE FUNCTION public.find_customer_prefill_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH orig AS (
    SELECT to_jsonb(r.*) AS j
    FROM customer_registrations r
    WHERE auth.uid() IS NOT NULL
      AND length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
      AND right(regexp_replace(coalesce(r.whatsapp, ''), '\D', '', 'g'), 8)
          = right(regexp_replace(p_phone, '\D', '', 'g'), 8)
      AND coalesce(btrim(r.full_name), '') <> ''
      AND length(regexp_replace(coalesce(r.cpf, ''), '\D', '', 'g')) = 11
      AND coalesce(btrim(r.address), '') NOT IN ('', 'Pendente')
      AND coalesce(btrim(r.city), '') NOT IN ('', 'Pendente')
      AND regexp_replace(coalesce(r.cep, ''), '\D', '', 'g') NOT IN ('', '00000000')
    ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
    LIMIT 1
  ), crm AS (
    SELECT jsonb_build_object(
      'full_name', c.name,
      'cpf', c.cpf,
      'email', c.email,
      'whatsapp', c.phone_e164,
      'cep', c.cep,
      'address', c.address,
      'address_number', c.address_number,
      'complement', c.complement,
      'neighborhood', c.neighborhood,
      'city', c.city,
      'state', c.state
    ) AS j
    FROM customers_unified c
    WHERE auth.uid() IS NOT NULL
      AND length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
      AND c.phone_suffix8 = right(regexp_replace(p_phone, '\D', '', 'g'), 8)
      AND c.merged_into_id IS NULL
      AND c.is_archived IS NOT TRUE
      AND coalesce(btrim(c.name), '') <> ''
      AND length(regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g')) = 11
      AND coalesce(btrim(c.address), '') NOT IN ('', 'Pendente')
      AND coalesce(btrim(c.city), '') NOT IN ('', 'Pendente')
      AND regexp_replace(coalesce(c.cep, ''), '\D', '', 'g') NOT IN ('', '00000000')
    ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
    LIMIT 1
  )
  SELECT coalesce((SELECT j FROM orig), (SELECT j FROM crm));
$function$;