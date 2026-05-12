CREATE TABLE public.ai_stock_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analise JSONB NOT NULL,
  contexto_resumo JSONB,
  usage JSONB,
  model TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_stock_analyses_created_at ON public.ai_stock_analyses (created_at DESC);

ALTER TABLE public.ai_stock_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock analyses"
ON public.ai_stock_analyses FOR SELECT
TO authenticated
USING (true);