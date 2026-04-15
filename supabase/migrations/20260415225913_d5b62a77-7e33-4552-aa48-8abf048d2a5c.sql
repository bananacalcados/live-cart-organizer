-- Table to store agent execution history
CREATE TABLE public.agent_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_data JSONB DEFAULT '{}'::jsonb,
  output_result TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage agent_executions"
ON public.agent_executions FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Allow service role (edge functions) full access
CREATE POLICY "Service role full access on agent_executions"
ON public.agent_executions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_agent_executions_agent_name ON public.agent_executions(agent_name);
CREATE INDEX idx_agent_executions_executed_at ON public.agent_executions(executed_at DESC);

-- Table to store weekly context (novidades, etc.)
CREATE TABLE public.agent_weekly_context (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  week_start DATE NOT NULL DEFAULT date_trunc('week', CURRENT_DATE)::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(key, week_start)
);

ALTER TABLE public.agent_weekly_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage agent_weekly_context"
ON public.agent_weekly_context FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role full access on agent_weekly_context"
ON public.agent_weekly_context FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_agent_executions_updated_at
BEFORE UPDATE ON public.agent_executions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_agent_weekly_context_updated_at
BEFORE UPDATE ON public.agent_weekly_context
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();