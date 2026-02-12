
-- Table to control which sellers are active per store
CREATE TABLE public.pos_store_sellers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  seller_id TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  tiny_seller_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, seller_id)
);

ALTER TABLE public.pos_store_sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Full access to pos_store_sellers" ON public.pos_store_sellers FOR ALL USING (true) WITH CHECK (true);

-- Prizes configuration per store
CREATE TABLE public.pos_prizes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  min_points INTEGER NOT NULL DEFAULT 0,
  prize_type TEXT NOT NULL DEFAULT 'weekly',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_prizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Full access to pos_prizes" ON public.pos_prizes FOR ALL USING (true) WITH CHECK (true);

-- Seller tasks (manual + auto-generated contact tasks)
CREATE TABLE public.pos_seller_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  seller_id TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'contact',
  title TEXT NOT NULL,
  description TEXT,
  customer_phone TEXT,
  customer_name TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  rfm_segment TEXT,
  points_reward INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_seller_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Full access to pos_seller_tasks" ON public.pos_seller_tasks FOR ALL USING (true) WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_pos_store_sellers_updated_at BEFORE UPDATE ON public.pos_store_sellers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pos_prizes_updated_at BEFORE UPDATE ON public.pos_prizes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pos_seller_tasks_updated_at BEFORE UPDATE ON public.pos_seller_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
