
-- 1. Enable unaccent extension
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;

-- 2. Create search function for accent-insensitive product search
CREATE OR REPLACE FUNCTION public.search_products_unaccent(search_term text, p_store_id uuid)
RETURNS SETOF pos_products
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT * FROM pos_products
  WHERE store_id = p_store_id
    AND is_active = true
    AND (
      unaccent(name) ILIKE '%' || unaccent(search_term) || '%'
      OR sku ILIKE '%' || search_term || '%'
      OR barcode = search_term
    )
  ORDER BY name
  LIMIT 50;
$$;

-- 3. Add missing columns to pos_exchanges (if not exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_exchanges' AND column_name='original_sale_source') THEN
    ALTER TABLE pos_exchanges ADD COLUMN original_sale_source text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_exchanges' AND column_name='original_seller_id') THEN
    ALTER TABLE pos_exchanges ADD COLUMN original_seller_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_exchanges' AND column_name='original_seller_name') THEN
    ALTER TABLE pos_exchanges ADD COLUMN original_seller_name text;
  END IF;
END $$;

-- 4. Add crediario columns to pos_sales (if not exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_sales' AND column_name='crediario_status') THEN
    ALTER TABLE pos_sales ADD COLUMN crediario_status text DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_sales' AND column_name='crediario_due_date') THEN
    ALTER TABLE pos_sales ADD COLUMN crediario_due_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_sales' AND column_name='crediario_paid_at') THEN
    ALTER TABLE pos_sales ADD COLUMN crediario_paid_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_sales' AND column_name='crediario_paid_method') THEN
    ALTER TABLE pos_sales ADD COLUMN crediario_paid_method text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_sales' AND column_name='crediario_paid_amount') THEN
    ALTER TABLE pos_sales ADD COLUMN crediario_paid_amount numeric;
  END IF;
END $$;
