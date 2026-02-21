
-- Strategy tasks table (Notion-style task list per store)
CREATE TABLE public.strategy_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.strategy_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT 'store' CHECK (scope IN ('store', 'global')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access" ON public.strategy_tasks
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_strategy_tasks_updated_at
  BEFORE UPDATE ON public.strategy_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_strategy_tasks_store ON public.strategy_tasks(store_id);
CREATE INDEX idx_strategy_tasks_parent ON public.strategy_tasks(parent_id);
CREATE INDEX idx_strategy_tasks_scope ON public.strategy_tasks(scope);
