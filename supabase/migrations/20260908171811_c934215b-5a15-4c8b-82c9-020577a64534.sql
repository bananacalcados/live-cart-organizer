UPDATE public.fiscal_documents SET status='rejected', rejection_message='Tentativa duplicada durante indisponibilidade do emissor'
WHERE pos_sale_id='e2b56aed-038b-463f-a6ad-c2408cb8833d' AND status='pending_sefaz'
AND id <> (SELECT id FROM public.fiscal_documents WHERE pos_sale_id='e2b56aed-038b-463f-a6ad-c2408cb8833d' AND status='pending_sefaz' ORDER BY created_at DESC LIMIT 1);