-- C. Realtime seletivo: remover tabelas sem listeners no frontend
-- Auditado via rg "table: '<nome>'" em src/ — todas com 0 matches
ALTER PUBLICATION supabase_realtime DROP TABLE public.bank_transactions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_nps_surveys;
ALTER PUBLICATION supabase_realtime DROP TABLE public.customer_registrations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.exchange_requests;
ALTER PUBLICATION supabase_realtime DROP TABLE public.group_campaigns;
ALTER PUBLICATION supabase_realtime DROP TABLE public.inventory_correction_queue;
ALTER PUBLICATION supabase_realtime DROP TABLE public.marketing_campaigns;
ALTER PUBLICATION supabase_realtime DROP TABLE public.marketing_send_logs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.message_templates;
ALTER PUBLICATION supabase_realtime DROP TABLE public.meta_message_queue;
ALTER PUBLICATION supabase_realtime DROP TABLE public.paypal_payments;
ALTER PUBLICATION supabase_realtime DROP TABLE public.pos_product_requests;
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_profiles;
ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_groups;
ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_numbers;
ALTER PUBLICATION supabase_realtime DROP TABLE public.zoppy_customers;
ALTER PUBLICATION supabase_realtime DROP TABLE public.zoppy_sales;