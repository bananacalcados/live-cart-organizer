
CREATE OR REPLACE FUNCTION lookup_crm_by_phones(p_phones text[])
RETURNS TABLE(
  phone text,
  crm_name text,
  crm_source text,
  crm_source_id text
) AS $$
  WITH phone_suffixes AS (
    SELECT p, right(regexp_replace(p, '[^0-9]', '', 'g'), 8) as suffix
    FROM unnest(p_phones) AS p
  ),
  all_matches AS (
    -- pos_customers (priority 1) - uses whatsapp column
    SELECT ps.p as phone, pc.name as crm_name, 'pos_customer' as crm_source, pc.id::text as crm_source_id, 1 as prio
    FROM phone_suffixes ps
    JOIN pos_customers pc ON right(regexp_replace(pc.whatsapp, '[^0-9]', '', 'g'), 8) = ps.suffix
    WHERE pc.whatsapp IS NOT NULL AND pc.name IS NOT NULL AND pc.name != ''

    UNION ALL

    -- zoppy_customers (priority 2) - uses phone column, concat first_name + last_name
    SELECT ps.p, TRIM(COALESCE(zc.first_name, '') || ' ' || COALESCE(zc.last_name, '')), 'zoppy_customer', zc.id::text, 2
    FROM phone_suffixes ps
    JOIN zoppy_customers zc ON right(regexp_replace(zc.phone, '[^0-9]', '', 'g'), 8) = ps.suffix
    WHERE zc.phone IS NOT NULL AND (zc.first_name IS NOT NULL OR zc.last_name IS NOT NULL)

    UNION ALL

    -- campaign_leads (priority 3) - uses phone column
    SELECT ps.p, cl.name, 'campaign_lead', cl.id::text, 3
    FROM phone_suffixes ps
    JOIN campaign_leads cl ON right(regexp_replace(cl.phone, '[^0-9]', '', 'g'), 8) = ps.suffix
    WHERE cl.phone IS NOT NULL AND cl.name IS NOT NULL AND cl.name != ''

    UNION ALL

    -- customers (priority 4) - uses whatsapp column
    SELECT ps.p, c.instagram_handle, 'customer', c.id::text, 4
    FROM phone_suffixes ps
    JOIN customers c ON right(regexp_replace(c.whatsapp, '[^0-9]', '', 'g'), 8) = ps.suffix
    WHERE c.whatsapp IS NOT NULL
  )
  SELECT DISTINCT ON (phone) phone, crm_name, crm_source, crm_source_id
  FROM all_matches
  WHERE crm_name IS NOT NULL AND TRIM(crm_name) != ''
  ORDER BY phone, prio;
$$ LANGUAGE sql SECURITY DEFINER;
