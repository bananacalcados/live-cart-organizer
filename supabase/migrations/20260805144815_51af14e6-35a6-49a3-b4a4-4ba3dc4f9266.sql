-- 1) Cancela a venda roteada indevidamente (trigger devolve os 2 itens ao estoque do Pérola)
UPDATE public.pos_sales
   SET status = 'cancelled',
       notes = COALESCE(notes || E'\n', '') || 'Cancelada em correção manual: pedido da Live foi marcado como pago por engano (webhook AppMax 122070930 pertencia ao link avulso de R$ 300).',
       updated_at = now()
 WHERE id = '88ed5a7d-7118-4bd4-99bf-b0d16d1f93e6';

-- 2) Reverte o pedido da Live para não pago (guard precisa ser suspenso, pois a marcação veio de webhook)
ALTER TABLE public.orders DISABLE TRIGGER trg_orders_payment_source_guard;

UPDATE public.orders
   SET is_paid = false,
       paid_externally = false,
       paid_at = NULL,
       payment_confirmed_source = NULL,
       appmax_order_id = NULL,
       payment_method_label = NULL,
       installments = NULL,
       pos_sale_id = NULL,
       pos_routing_claimed_at = NULL,
       stage = 'awaiting_payment',
       updated_at = now()
 WHERE id = '22eae440-b88e-4222-a544-fbbd626fab0c';

ALTER TABLE public.orders ENABLE TRIGGER trg_orders_payment_source_guard;

-- 3) Marca a venda do link avulso (R$ 300) como paga via AppMax
UPDATE public.pos_sales
   SET status = 'paid',
       paid_at = '2026-08-04 22:28:00+00',
       payment_gateway = 'appmax',
       payment_method = 'Cartão de Crédito',
       appmax_order_id = '122070930',
       payment_details = COALESCE(payment_details, '{}'::jsonb)
         || jsonb_build_object(
              'payment_method', 'Cartão de Crédito',
              'gateway', 'appmax',
              'gateway_order_id', '122070930',
              'payment_confirmed_source', 'manual_correction'
            ),
       notes = COALESCE(notes || E'\n', '') || 'Marcada como paga em correção manual: AppMax 122070930 (R$ 300) confirmado.',
       updated_at = now()
 WHERE id = 'a8f49a7a-70bb-4a0d-b51e-b79b70d5d28a';