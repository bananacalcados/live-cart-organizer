ALTER TABLE public.pos_customers 
  ADD COLUMN IF NOT EXISTS shoe_size text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS has_children boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS children_age_range text;