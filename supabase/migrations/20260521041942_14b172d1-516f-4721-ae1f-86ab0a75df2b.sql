
ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS default_weight_kg numeric(10,3),
  ADD COLUMN IF NOT EXISTS default_height_cm numeric(10,2),
  ADD COLUMN IF NOT EXISTS default_width_cm numeric(10,2),
  ADD COLUMN IF NOT EXISTS default_length_cm numeric(10,2);

-- Defaults realistas por categoria (caixa de sapato típica)
UPDATE public.product_categories SET default_weight_kg = 0.350, default_height_cm = 12, default_width_cm = 18, default_length_cm = 32 WHERE slug = 'chinelos';
UPDATE public.product_categories SET default_weight_kg = 0.500, default_height_cm = 14, default_width_cm = 20, default_length_cm = 34 WHERE slug = 'tamancos';
UPDATE public.product_categories SET default_weight_kg = 0.400, default_height_cm = 12, default_width_cm = 20, default_length_cm = 34 WHERE slug = 'sandalias-baixas';
UPDATE public.product_categories SET default_weight_kg = 0.350, default_height_cm = 12, default_width_cm = 20, default_length_cm = 32 WHERE slug = 'rasteirinhas';
UPDATE public.product_categories SET default_weight_kg = 0.450, default_height_cm = 12, default_width_cm = 20, default_length_cm = 34 WHERE slug = 'saltos';
UPDATE public.product_categories SET default_weight_kg = 0.350, default_height_cm = 12, default_width_cm = 20, default_length_cm = 32 WHERE slug = 'sapatilhas';
UPDATE public.product_categories SET default_weight_kg = 0.700, default_height_cm = 14, default_width_cm = 22, default_length_cm = 36 WHERE slug = 'tenis-esportivo';
UPDATE public.product_categories SET default_weight_kg = 0.650, default_height_cm = 14, default_width_cm = 22, default_length_cm = 36 WHERE slug = 'tenis-casual';
UPDATE public.product_categories SET default_weight_kg = 0.700, default_height_cm = 14, default_width_cm = 22, default_length_cm = 36 WHERE slug = 'chuteiras';
UPDATE public.product_categories SET default_weight_kg = 1.000, default_height_cm = 18, default_width_cm = 22, default_length_cm = 36 WHERE slug = 'botas';
UPDATE public.product_categories SET default_weight_kg = 0.600, default_height_cm = 14, default_width_cm = 22, default_length_cm = 36 WHERE slug = 'sapato-social-masculino';
UPDATE public.product_categories SET default_weight_kg = 0.600, default_height_cm = 14, default_width_cm = 22, default_length_cm = 36 WHERE slug = 'mocassim';
UPDATE public.product_categories SET default_weight_kg = 0.500, default_height_cm = 14, default_width_cm = 20, default_length_cm = 34 WHERE slug = 'papetes';
UPDATE public.product_categories SET default_weight_kg = 0.300, default_height_cm = 10, default_width_cm = 16, default_length_cm = 28 WHERE slug = 'babuches';
UPDATE public.product_categories SET default_weight_kg = 0.500, default_height_cm = 15, default_width_cm = 25, default_length_cm = 30 WHERE slug = 'bolsas';
