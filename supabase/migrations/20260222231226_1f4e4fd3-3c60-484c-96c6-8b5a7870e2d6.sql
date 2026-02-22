-- Add unique constraint to prevent duplicate registrations per order
-- First, clean up duplicates keeping the earliest one
DELETE FROM public.customer_registrations
WHERE id NOT IN (
  SELECT DISTINCT ON (order_id) id
  FROM public.customer_registrations
  ORDER BY order_id, created_at ASC
);

-- Add unique constraint
ALTER TABLE public.customer_registrations
ADD CONSTRAINT customer_registrations_order_id_unique UNIQUE (order_id);