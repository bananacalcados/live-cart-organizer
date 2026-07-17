UPDATE pos_sales s
SET customer_name = c.name
FROM pos_customers c
WHERE s.customer_id = c.id
  AND s.customer_name IS NULL
  AND (s.sale_type = 'exchange' OR s.external_source = 'troca');