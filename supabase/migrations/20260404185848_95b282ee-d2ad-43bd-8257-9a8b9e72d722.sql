
CREATE TABLE public.product_visual_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_product_id TEXT NOT NULL UNIQUE,
  product_title TEXT NOT NULL,
  visual_tags TEXT[] NOT NULL DEFAULT '{}',
  analyzed_image_urls TEXT[] NOT NULL DEFAULT '{}',
  ai_description TEXT,
  last_analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast tag searches
CREATE INDEX idx_product_visual_tags_tags ON public.product_visual_tags USING GIN(visual_tags);
CREATE INDEX idx_product_visual_tags_shopify_id ON public.product_visual_tags(shopify_product_id);

-- Enable RLS
ALTER TABLE public.product_visual_tags ENABLE ROW LEVEL SECURITY;

-- Public read access (catalog data)
CREATE POLICY "Visual tags are publicly readable"
ON public.product_visual_tags
FOR SELECT
USING (true);

-- Service role can manage (edge functions)
CREATE POLICY "Service role can manage visual tags"
ON public.product_visual_tags
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_product_visual_tags_updated_at
BEFORE UPDATE ON public.product_visual_tags
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
