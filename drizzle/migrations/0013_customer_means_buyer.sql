
-- Cliente = quem tem pelo menos uma compra. Fichas criadas automaticamente pelo chat
-- (sem compra) continuam existindo em customers_unified (modal do WhatsApp, histórico),
-- mas deixam de contar como cliente nas listas de disparo/CRM e na classificação de órfãos.

-- 1) View de clientes usada por disparos, CRM e RFM: só compradores.
CREATE OR REPLACE VIEW public.crm_customers_v AS
SELECT id,
    customer_code AS zoppy_id,
    NULLIF(split_part(COALESCE(name, ''::text), ' '::text, 1), ''::text) AS first_name,
    NULLIF(btrim(SUBSTRING(COALESCE(name, ''::text) FROM POSITION((' '::text) IN (COALESCE(name, ''::text))) + 1)), ''::text) AS last_name,
    name,
    phone_e164 AS phone,
    phone_e164,
    phone_suffix8,
    email,
    cpf,
    city,
    state,
    COALESCE(NULLIF(btrim(region_type), ''::text), 'online'::text) AS region_type,
    ddd,
    rfm_r AS rfm_recency_score,
    rfm_f AS rfm_frequency_score,
    rfm_m AS rfm_monetary_score,
    rfm_total AS rfm_total_score,
    rfm_segment,
    total_orders,
    total_spent,
    avg_ticket,
    last_purchase_at,
    first_purchase_at,
    tags,
    opt_out_mass_dispatch,
    is_archived,
    created_at,
    updated_at,
    gender,
    purchased_brands,
    purchased_categories,
    purchased_sizes,
    purchased_stores,
    payment_methods,
    lead_temperature,
    legacy_orders,
    legacy_spent,
    purchased_channels
   FROM customers_unified cu
  WHERE is_archived = false AND merged_into_id IS NULL
    AND (COALESCE(total_orders, 0) > 0 OR COALESCE(legacy_orders, 0) > 0);

-- 2) Classificação de membro de grupo VIP: ficha sem compra não é cliente.
CREATE OR REPLACE FUNCTION public.classify_group_member(_phone text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH s AS (SELECT right(regexp_replace(coalesce(_phone,''),'\D','','g'),8) AS s8)
  SELECT CASE
    WHEN (SELECT length(s8) FROM s) < 8 THEN 'invalid'
    WHEN EXISTS (SELECT 1 FROM public.customers_unified c, s WHERE c.phone_suffix8 = s.s8 AND (COALESCE(c.total_orders,0) > 0 OR COALESCE(c.legacy_orders,0) > 0)) THEN 'customer'
    WHEN EXISTS (SELECT 1 FROM public.event_leads e, s WHERE right(regexp_replace(coalesce(e.phone,''),'\D','','g'),8) = s.s8)
      OR EXISTS (SELECT 1 FROM public.lp_leads l, s WHERE right(regexp_replace(coalesce(l.phone,''),'\D','','g'),8) = s.s8)
      OR EXISTS (SELECT 1 FROM public.ad_leads a, s WHERE right(regexp_replace(coalesce(a.phone,''),'\D','','g'),8) = s.s8)
      OR EXISTS (SELECT 1 FROM public.link_page_leads k, s WHERE right(regexp_replace(coalesce(k.phone,''),'\D','','g'),8) = s.s8)
      OR EXISTS (SELECT 1 FROM public.customers_unified c2, s WHERE c2.phone_suffix8 = s.s8)
      THEN 'lead'
    ELSE 'orphan'
  END;
$function$;

-- 3) refresh_vip_orphans: mesma regra na classificação em lote.
CREATE OR REPLACE FUNCTION public.refresh_vip_orphans()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inserted int; v_promoted int; v_total int;
BEGIN
  WITH vip_group_ids AS (
    SELECT DISTINCT unnest(target_groups) AS gid FROM public.group_campaigns
  ),
  vip_groups AS (
    SELECT g.id, g.name, regexp_replace(g.group_id,'\D','','g') AS digits
    FROM public.whatsapp_groups g JOIN vip_group_ids v ON v.gid = g.id
  ),
  member_rows AS (
    SELECT right(regexp_replace(m.phone,'\D','','g'),8) AS s8,
           regexp_replace(m.phone,'\D','','g') AS phone_full,
           m.display_name, m.customer_id,
           regexp_replace(m.group_id,'\D','','g') AS digits
    FROM public.whatsapp_group_members m
    WHERE length(regexp_replace(m.phone,'\D','','g')) >= 12
  ),
  joined AS (
    SELECT mr.s8, mr.phone_full, mr.display_name, mr.customer_id,
           vg.id::text AS group_uuid, vg.name AS group_name
    FROM member_rows mr JOIN vip_groups vg ON vg.digits = mr.digits
  ),
  agg AS (
    SELECT s8,
      (array_agg(phone_full ORDER BY length(phone_full) DESC))[1] AS phone,
      (array_agg(display_name) FILTER (WHERE display_name IS NOT NULL AND display_name <> ''))[1] AS display_name,
      array_agg(DISTINCT group_uuid) AS group_ids,
      array_agg(DISTINCT group_name) AS group_names,
      bool_or(customer_id IS NOT NULL) AS has_customer_id
    FROM joined GROUP BY s8
  ),
  classified AS (
    SELECT a.*,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.customers_unified c WHERE c.phone_suffix8 = a.s8 AND (COALESCE(c.total_orders,0) > 0 OR COALESCE(c.legacy_orders,0) > 0)) THEN 'customer'
        WHEN EXISTS (SELECT 1 FROM public.event_leads e WHERE right(regexp_replace(coalesce(e.phone,''),'\D','','g'),8) = a.s8)
          OR EXISTS (SELECT 1 FROM public.lp_leads l WHERE right(regexp_replace(coalesce(l.phone,''),'\D','','g'),8) = a.s8)
          OR EXISTS (SELECT 1 FROM public.ad_leads ad WHERE right(regexp_replace(coalesce(ad.phone,''),'\D','','g'),8) = a.s8)
          OR EXISTS (SELECT 1 FROM public.link_page_leads k WHERE right(regexp_replace(coalesce(k.phone,''),'\D','','g'),8) = a.s8)
          OR a.has_customer_id
          OR EXISTS (SELECT 1 FROM public.customers_unified c2 WHERE c2.phone_suffix8 = a.s8)
          THEN 'lead'
        ELSE 'orphan'
      END AS klass
    FROM agg a
  )
  INSERT INTO public.vip_orphan_contacts
    (phone, phone_suffix8, display_name, group_ids, group_names, status, last_seen_at)
  SELECT c.phone, c.s8, c.display_name, c.group_ids, c.group_names, 'orphan', now()
  FROM classified c WHERE c.klass = 'orphan'
  ON CONFLICT (phone_suffix8) DO UPDATE SET
    phone        = EXCLUDED.phone,
    display_name = COALESCE(public.vip_orphan_contacts.display_name, EXCLUDED.display_name),
    group_ids    = EXCLUDED.group_ids,
    group_names  = EXCLUDED.group_names,
    last_seen_at = now(),
    status       = CASE WHEN public.vip_orphan_contacts.opted_out THEN 'opted_out' ELSE 'orphan' END;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.vip_orphan_contacts o
  SET status = 'promoted'
  WHERE o.status = 'orphan' AND public.classify_group_member(o.phone) IN ('customer','lead');
  GET DIAGNOSTICS v_promoted = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.vip_orphan_contacts WHERE status = 'orphan';
  RETURN jsonb_build_object('upserted', v_inserted, 'promoted', v_promoted, 'active_orphans', v_total);
END;
$function$;
