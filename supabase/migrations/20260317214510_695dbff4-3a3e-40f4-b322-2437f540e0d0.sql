CREATE OR REPLACE FUNCTION public.get_leads_for_recovery()
RETURNS TABLE (
    id text, source_table text, phone text, name text,
    cart_items jsonb, cart_total numeric,
    status text, chosen_payment_method text,
    pix_code text, pix_expires_at timestamp with time zone,
    recovery_disparo integer, recovery_ultimo_disparo_at timestamp with time zone,
    recovery_session_id text, created_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id::TEXT, 'catalog' as source_table,
    whatsapp as phone, instagram_handle as name,
    cart_items, cart_total, status,
    chosen_payment_method, pix_code, pix_expires_at,
    recovery_disparo, recovery_ultimo_disparo_at,
    recovery_session_id, created_at
  FROM catalog_lead_registrations
  WHERE status IN ('browsing','checkout_started')
    AND whatsapp IS NOT NULL AND cart_items IS NOT NULL
  UNION ALL
  SELECT id::TEXT, 'lp_leads' as source_table,
    phone, name,
    CASE 
      WHEN metadata->>'cartSummary' IS NULL THEN NULL
      WHEN left(trim(metadata->>'cartSummary'), 1) = '[' 
           OR left(trim(metadata->>'cartSummary'), 1) = '{' 
      THEN (metadata->>'cartSummary')::jsonb
      ELSE to_jsonb(metadata->>'cartSummary')
    END as cart_items,
    COALESCE(
      NULLIF(
        replace(
          CASE
            WHEN metadata->>'totalAmount' ~ ',\d{1,2}$'
              THEN regexp_replace(metadata->>'totalAmount', '[^0-9,]', '', 'g')
            ELSE regexp_replace(metadata->>'totalAmount', '[^0-9.]', '', 'g')
          END,
          ',', '.'
        ),
        ''
      )::numeric,
      0::numeric
    ) as cart_total,
    CASE WHEN metadata->>'chosen_payment_method' IS NOT NULL
         THEN 'checkout_started' ELSE 'browsing' END as status,
    metadata->>'chosen_payment_method',
    metadata->>'pix_code',
    (metadata->>'pix_expires_at')::timestamptz,
    recovery_disparo, recovery_ultimo_disparo_at,
    recovery_session_id, created_at
  FROM lp_leads
  WHERE source = 'abandoned_cart'
    AND phone IS NOT NULL
    AND converted = false
  ORDER BY created_at DESC LIMIT 500;
$$;