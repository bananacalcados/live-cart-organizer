INSERT INTO public.livete_payment_confirmation_sent (order_id, sent_at)
SELECT order_id, min(created_at)
FROM public.ai_conversation_logs
WHERE ai_decision = 'payment_confirmation_sent' AND order_id IS NOT NULL
GROUP BY order_id
ON CONFLICT (order_id) DO NOTHING;