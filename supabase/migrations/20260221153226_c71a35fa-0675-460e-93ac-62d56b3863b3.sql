
-- Create product capture sessions table
CREATE TABLE public.product_capture_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  status TEXT NOT NULL DEFAULT 'capturing',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create product capture items table
CREATE TABLE public.product_capture_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.product_capture_sessions(id) ON DELETE CASCADE,
  parent_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  barcode TEXT NOT NULL,
  size TEXT,
  color TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  reference_code TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  tiny_product_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_capture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_capture_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated users
CREATE POLICY "Authenticated users can manage capture sessions"
  ON public.product_capture_sessions FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage capture items"
  ON public.product_capture_items FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX idx_capture_items_session ON public.product_capture_items(session_id);
CREATE INDEX idx_capture_items_parent ON public.product_capture_items(session_id, parent_code);
CREATE INDEX idx_capture_sessions_store ON public.product_capture_sessions(store_id, status);

-- Triggers for updated_at
CREATE TRIGGER update_capture_sessions_updated_at
  BEFORE UPDATE ON public.product_capture_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
