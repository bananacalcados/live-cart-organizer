
UPDATE pos_sales s
SET payment_method = CASE
    WHEN ca.payment_method = 'pix' THEN 'PIX'
    WHEN ca.payment_method = 'credit_card' THEN 'Cartão de Crédito'
    WHEN ca.payment_method IS NOT NULL THEN ca.payment_method
    WHEN s.payment_gateway = 'appmax' THEN 'Cartão de Crédito'
    ELSE 'Checkout Online'
  END
FROM (
  SELECT DISTINCT ON (sale_id) sale_id, payment_method
  FROM pos_checkout_attempts
  WHERE status = 'success'
  ORDER BY sale_id, created_at DESC
) ca
WHERE ca.sale_id = s.id::text
  AND s.payment_method IS NULL
  AND s.status IN ('paid','completed','pending_sync')
  AND s.payment_gateway IS NOT NULL;

-- Fallback para os que não têm tentativa registrada
UPDATE pos_sales
SET payment_method = CASE WHEN payment_gateway = 'appmax' THEN 'Cartão de Crédito' ELSE 'Checkout Online' END
WHERE payment_method IS NULL
  AND status IN ('paid','completed','pending_sync')
  AND payment_gateway IS NOT NULL;
