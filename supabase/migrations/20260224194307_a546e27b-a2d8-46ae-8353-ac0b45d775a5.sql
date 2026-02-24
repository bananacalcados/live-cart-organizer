
CREATE TABLE public.pos_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  goal_type text NOT NULL CHECK (goal_type IN ('avg_ticket', 'revenue', 'seller_revenue', 'items_sold')),
  goal_value numeric NOT NULL,
  period text NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  seller_id uuid REFERENCES public.pos_sellers(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pos_goals" ON public.pos_goals FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_pos_goals_updated_at BEFORE UPDATE ON public.pos_goals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
