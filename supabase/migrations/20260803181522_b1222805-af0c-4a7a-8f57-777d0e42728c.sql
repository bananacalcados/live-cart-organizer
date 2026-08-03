ALTER TABLE public.customer_registrations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_registrations;