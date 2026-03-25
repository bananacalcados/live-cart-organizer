-- Add stage_atendimento column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stage_atendimento text DEFAULT NULL;

-- Create RPC to update it
CREATE OR REPLACE FUNCTION public.update_order_stage(p_order_id text, p_stage text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE orders
  SET stage_atendimento = p_stage
  WHERE id::text = p_order_id;
END;
$$;