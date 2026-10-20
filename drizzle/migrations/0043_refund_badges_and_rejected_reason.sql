ALTER TABLE public.gateway_refunds ADD COLUMN IF NOT EXISTS rejected_reason text;

CREATE OR REPLACE FUNCTION public.refund_badges_for_sources(order_ids uuid[], sale_ids uuid[])
RETURNS TABLE(id uuid, display_id uuid, source text, source_id uuid, status text, amount numeric, refund_type text, completed_at timestamptz, created_at timestamptz, has_receipt boolean, receipt_sent_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH o AS (SELECT unnest((coalesce(order_ids,'{}'::uuid[]))[1:200]) AS oid),
       s AS (SELECT unnest((coalesce(sale_ids,'{}'::uuid[]))[1:200]) AS sid),
       m AS (
         SELECT o.oid AS display_id, 'order'::text AS src, o.oid AS sid FROM o
         UNION
         SELECT s.sid, 'pos_sale', s.sid FROM s
         UNION
         SELECT s.sid, 'order', ord.id FROM s JOIN public.orders ord ON ord.pos_sale_id = s.sid
         UNION
         SELECT o.oid, 'pos_sale', ord.pos_sale_id FROM o JOIN public.orders ord ON ord.id = o.oid WHERE ord.pos_sale_id IS NOT NULL
       )
  SELECT g.id, m.display_id, g.source, g.source_id::uuid, g.status, g.amount, g.refund_type, g.completed_at, g.created_at,
         (g.receipt_path IS NOT NULL), g.receipt_sent_at
  FROM m JOIN public.gateway_refunds g ON g.source = m.src AND g.source_id::text = m.sid::text
  WHERE auth.uid() IS NOT NULL
  ORDER BY g.created_at DESC
  LIMIT 200
$$;

REVOKE ALL ON FUNCTION public.refund_badges_for_sources(uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_badges_for_sources(uuid[], uuid[]) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.gateway_refunds;