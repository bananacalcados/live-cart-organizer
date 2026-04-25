ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_history;
ALTER TABLE public.dispatch_history REPLICA IDENTITY FULL;