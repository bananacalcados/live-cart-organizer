-- Enable realtime for expedition_order_items so multiple users see changes instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.expedition_order_items;