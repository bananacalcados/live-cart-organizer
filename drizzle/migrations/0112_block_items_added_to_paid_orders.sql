CREATE OR REPLACE FUNCTION public.block_items_added_to_paid_orders()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(),'') NOT IN ('authenticated','anon') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT coalesce(p->>'id', p->>'shopifyId', p->>'sku') k, sum(coalesce((p->>'quantity')::numeric,1)) q
      FROM jsonb_array_elements(coalesce(NEW.products::jsonb,'[]'::jsonb)) p GROUP BY 1
    ) n
    LEFT JOIN (
      SELECT coalesce(p->>'id', p->>'shopifyId', p->>'sku') k, sum(coalesce((p->>'quantity')::numeric,1)) q
      FROM jsonb_array_elements(coalesce(OLD.products::jsonb,'[]'::jsonb)) p GROUP BY 1
    ) o ON o.k IS NOT DISTINCT FROM n.k
    WHERE n.q > coalesce(o.q,0)
  ) THEN
    RAISE EXCEPTION 'Pedido já pago: não é possível adicionar produtos. Crie um novo pedido para os itens extras.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_items_added_to_paid_orders ON public.orders;
CREATE TRIGGER trg_block_items_added_to_paid_orders
BEFORE UPDATE OF products ON public.orders
FOR EACH ROW
WHEN (OLD.is_paid IS TRUE AND OLD.products IS DISTINCT FROM NEW.products)
EXECUTE FUNCTION public.block_items_added_to_paid_orders();