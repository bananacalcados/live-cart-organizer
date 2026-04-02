ALTER TABLE public.ad_campaigns_ai 
ADD COLUMN shipping_rule jsonb DEFAULT '{"type": "calculate"}'::jsonb,
ADD COLUMN pix_discount_percent numeric DEFAULT 5;