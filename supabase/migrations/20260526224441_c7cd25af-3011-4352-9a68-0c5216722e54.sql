WITH matches AS (
  SELECT DISTINCT ON (s.id) s.id sale_id, c.id cid
  FROM pos_sales s
  JOIN pos_customers c ON right(regexp_replace(c.whatsapp,'\D','','g'),8) = right(regexp_replace(s.customer_phone,'\D','','g'),8)
  WHERE s.created_at >= CURRENT_DATE
    AND s.customer_id IS NULL
    AND s.customer_phone IS NOT NULL
    AND s.customer_phone <> ''
  ORDER BY s.id, c.updated_at DESC NULLS LAST
)
UPDATE pos_sales p
SET customer_id = m.cid
FROM matches m
WHERE p.id = m.sale_id;