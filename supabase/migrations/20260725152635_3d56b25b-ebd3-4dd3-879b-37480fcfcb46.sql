-- 1) Religar pedidos de evento às vendas já existentes (1:1, telefone + valor + data)
CREATE TEMP TABLE _link AS
WITH po AS (
  SELECT o.id, o.event_id, o.created_at, public.event_phone_key(c.whatsapp) AS pkey,
         public.bc_order_total(o.products, o.discount_type, o.discount_value) AS val
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.event_id IS NOT NULL AND o.stage <> 'cancelled' AND o.merged_into_order_id IS NULL
    AND o.pos_sale_id IS NULL
    AND (COALESCE(o.is_paid,false) OR COALESCE(o.paid_externally,false)
         OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))
    AND public.event_phone_key(c.whatsapp) IS NOT NULL
),
m AS (
  SELECT po.id AS oid, po.event_id, ps.id AS sid, ps.sale_type,
         row_number() OVER (PARTITION BY po.id ORDER BY abs(extract(epoch FROM (ps.created_at - po.created_at)))) rn,
         row_number() OVER (PARTITION BY ps.id ORDER BY abs(extract(epoch FROM (ps.created_at - po.created_at)))) rn2
  FROM po
  JOIN public.pos_sales ps
    ON public.event_phone_key(ps.customer_phone) = po.pkey
   AND ps.status IN ('paid','completed','pending_pickup','pending_sync')
   AND ps.created_at BETWEEN po.created_at - interval '3 days' AND po.created_at + interval '10 days'
   AND abs(ps.total - po.val) < 0.02
   AND ps.source_order_id IS NULL
   AND ps.event_id IS NULL
)
SELECT oid, event_id, sid, sale_type FROM m WHERE rn = 1 AND rn2 = 1;

UPDATE public.orders o SET pos_sale_id = l.sid
FROM _link l WHERE o.id = l.oid AND o.pos_sale_id IS NULL;

UPDATE public.pos_sales ps
SET source_order_id = l.oid,
    event_id = l.event_id,
    sale_type = CASE WHEN ps.sale_type = 'physical' THEN ps.sale_type ELSE 'live' END
FROM _link l WHERE ps.id = l.sid;

-- 2) Leads orgânicos de WhatsApp que nunca foram registrados como lead
WITH cc AS (
  SELECT public.event_phone_key(c.phone) AS pkey,
         min(c.created_at) AS first_seen,
         (array_agg(c.display_name ORDER BY c.created_at))[1] AS nm,
         (array_agg(c.phone ORDER BY c.created_at))[1] AS phone
  FROM public.chat_contacts c
  WHERE c.phone NOT LIKE '%@g.us%'
    AND length(regexp_replace(c.phone,'\D','','g')) BETWEEN 12 AND 13
    AND public.event_phone_key(c.phone) IS NOT NULL
  GROUP BY 1
),
lp AS (SELECT DISTINCT public.event_phone_key(phone) AS pkey FROM public.lp_leads WHERE public.event_phone_key(phone) IS NOT NULL),
firstbuy AS (
  SELECT public.event_phone_key(customer_phone) AS pkey, min(created_at) AS fb
  FROM public.pos_sales
  WHERE status IN ('paid','completed','pending_pickup') AND public.event_phone_key(customer_phone) IS NOT NULL
  GROUP BY 1
)
INSERT INTO public.lp_leads (name, phone, campaign_tag, source, converted, created_at, metadata)
SELECT cc.nm, cc.phone,
       'contato-whats-' ||
         CASE WHEN extract(day FROM cc.first_seen) <= 7 THEN '1'
              WHEN extract(day FROM cc.first_seen) <= 14 THEN '2'
              WHEN extract(day FROM cc.first_seen) <= 21 THEN '3' ELSE '4' END
         || '-' || to_char(cc.first_seen,'MM-YY'),
       'organic_whatsapp_backfill', false, cc.first_seen,
       jsonb_build_object('captured_at', cc.first_seen, 'backfilled', true, 'backfill_batch', 'chat_contacts_2026_07')
FROM cc
LEFT JOIN lp USING (pkey)
LEFT JOIN firstbuy fb USING (pkey)
WHERE lp.pkey IS NULL
  AND (fb.fb IS NULL OR fb.fb > cc.first_seen);