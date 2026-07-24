
ALTER TABLE public.orders DISABLE TRIGGER trg_orders_payment_source_guard;

UPDATE public.orders 
SET is_paid = false,
    paid_at = NULL,
    stage = 'awaiting_payment',
    payment_confirmed_source = NULL,
    mercadopago_payment_id = NULL,
    notes = COALESCE(notes,'') || E'\n⚠️ Reset manual (2026-07-24): pagamento gateway_webhook não localizado no Mercado Pago; retornado para aguardando pagamento.'
WHERE id = '59873726-64a6-4daf-b80f-1e0c28bd778b';

ALTER TABLE public.orders ENABLE TRIGGER trg_orders_payment_source_guard;
