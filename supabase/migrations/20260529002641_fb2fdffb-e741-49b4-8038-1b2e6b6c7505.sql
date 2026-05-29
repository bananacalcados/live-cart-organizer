
-- 1) Remover linhas duplicadas "físicas" (clones) criadas indevidamente pelo
--    fluxo antigo de envio ao PDV, que compartilham o mesmo pedido Tiny com a
--    linha canônica (live / vinculada ao pedido CRM). Remove também os itens.
WITH clones AS (
  SELECT p.id AS phys_id
  FROM pos_sales p
  JOIN pos_sales l
    ON l.tiny_order_id = p.tiny_order_id
   AND l.id <> p.id
  WHERE p.tiny_order_id IS NOT NULL
    AND p.sale_type = 'physical'
    AND p.source_order_id IS NULL
    AND p.event_id IS NULL
    AND (l.source_order_id IS NOT NULL OR l.sale_type = 'live')
)
, del_items AS (
  DELETE FROM pos_sale_items WHERE sale_id IN (SELECT phys_id FROM clones)
)
DELETE FROM pos_sales WHERE id IN (SELECT phys_id FROM clones);

-- 2) Preencher forma de pagamento em vendas já PAGAS que ficaram sem método,
--    inferindo pelo gateway de pagamento. PAGO É PAGO — apenas classifica.
UPDATE pos_sales
SET payment_method = CASE
    WHEN payment_gateway = 'mercadopago' THEN 'PIX'
    WHEN payment_gateway = 'pix' THEN 'PIX'
    WHEN payment_gateway = 'pagarme' THEN 'Cartão de Crédito'
    WHEN payment_gateway = 'vindi' THEN 'Cartão de Crédito'
    WHEN payment_gateway = 'shopify' THEN 'shopify'
    ELSE payment_method
  END
WHERE payment_method IS NULL
  AND status IN ('paid','completed','pending_sync')
  AND payment_gateway IS NOT NULL;
