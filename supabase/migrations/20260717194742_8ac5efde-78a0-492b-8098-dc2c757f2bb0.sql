
UPDATE pos_sales
   SET status = 'cancelled'
 WHERE status = 'completed'
   AND status_cancelamento = 'cancelado';

DO $$
DECLARE
  t RECORD;
  new_sale_id UUID;
  v_subtotal NUMERIC;
  v_credito NUMERIC;
  v_diferenca NUMERIC;
  v_notas TEXT;
BEGIN
  FOR t IN
    SELECT td.id, td.codigo_devolucao, td.pedido_original_id, td.loja_origem_id,
           td.cliente_id, td.origem_canal, td.valor_devolvido, td.valor_reposicao,
           td.vendedora_troca_id
      FROM trocas_devolucoes td
     WHERE td.status = 'concluida'
       AND td.tipo = 'troca'
       AND NOT EXISTS (
             SELECT 1 FROM pos_sales ps
              WHERE ps.external_source = 'troca'
                AND ps.external_order_id = td.id::text
           )
       AND EXISTS (
             SELECT 1 FROM trocas_devolucoes_itens i
              WHERE i.troca_devolucao_id = td.id
                AND i.direcao = 'reposicao'
           )
  LOOP
    v_subtotal := COALESCE(t.valor_reposicao, 0);
    v_credito  := COALESCE(t.valor_devolvido, 0);
    v_diferenca := ROUND(v_subtotal - v_credito, 2);
    v_notas := format('🔁 Troca %s · Pedido original: %s · Crédito devolução: R$ %s · Diferença: R$ %s (backfill)',
                      t.codigo_devolucao, t.pedido_original_id,
                      to_char(v_credito, 'FM999999990.00'),
                      to_char(v_diferenca, 'FM999999990.00'));

    INSERT INTO pos_sales (
      store_id, seller_id, customer_id, subtotal, discount, total,
      payment_method, status, sale_type, external_source, external_order_id,
      notes, paid_at, revenue_attribution
    ) VALUES (
      t.loja_origem_id,
      t.vendedora_troca_id,
      t.cliente_id,
      v_subtotal,
      v_credito,
      GREATEST(0, v_diferenca),
      CASE WHEN v_diferenca > 0.009 THEN 'troca_com_diferenca' ELSE 'troca' END,
      'completed',
      'exchange',
      'troca',
      t.id::text,
      v_notas,
      NOW(),
      (CASE WHEN t.origem_canal::text = 'site' THEN 'online' ELSE 'store' END)::pos_revenue_attribution
    ) RETURNING id INTO new_sale_id;

    INSERT INTO pos_sale_items (
      sale_id, sku, barcode, product_name, variant_name, size,
      unit_price, quantity, total_price
    )
    SELECT
      new_sale_id,
      i.sku,
      i.barcode,
      COALESCE(i.produto_nome, i.sku, 'Produto'),
      i.tamanho,
      i.tamanho,
      COALESCE(i.valor_unitario, 0),
      COALESCE(i.quantidade, 0),
      COALESCE(i.valor_unitario, 0) * COALESCE(i.quantidade, 0)
      FROM trocas_devolucoes_itens i
     WHERE i.troca_devolucao_id = t.id
       AND i.direcao = 'reposicao';
  END LOOP;
END $$;
