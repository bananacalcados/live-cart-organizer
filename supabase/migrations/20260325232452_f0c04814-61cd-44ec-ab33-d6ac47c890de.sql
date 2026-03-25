
-- Tabela de base de conhecimento da Livete
CREATE TABLE public.ai_knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read knowledge base"
  ON public.ai_knowledge_base FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage knowledge base"
  ON public.ai_knowledge_base FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Tabela de logs de conversação da Livete
CREATE TABLE public.ai_conversation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  phone text NOT NULL,
  stage text,
  message_in text,
  message_out text,
  ai_decision text,
  tool_called text,
  tool_params jsonb,
  response_time_ms integer,
  error text,
  provider text DEFAULT 'anthropic',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_conversation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ai logs"
  ON public.ai_conversation_logs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service can insert ai logs"
  ON public.ai_conversation_logs FOR INSERT TO authenticated, anon
  WITH CHECK (true);

-- Index para busca rápida por pedido e phone
CREATE INDEX idx_ai_conversation_logs_order_id ON public.ai_conversation_logs(order_id);
CREATE INDEX idx_ai_conversation_logs_phone ON public.ai_conversation_logs(phone);
CREATE INDEX idx_ai_knowledge_base_category ON public.ai_knowledge_base(category);
