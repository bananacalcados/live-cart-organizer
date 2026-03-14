
-- Add ai_paused columns to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ai_paused boolean DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ai_paused_at timestamptz;

-- Create RPC to check if order AI is paused for a given phone
CREATE OR REPLACE FUNCTION public.check_order_ai_paused(p_phone text)
RETURNS TABLE(ai_paused boolean, order_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.ai_paused, o.id as order_id
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE right(regexp_replace(c.whatsapp, '[^0-9]', '', 'g'), 8) = right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 8)
    AND o.is_paid = false
    AND o.ai_paused = true
  ORDER BY o.created_at DESC
  LIMIT 1;
$$;
