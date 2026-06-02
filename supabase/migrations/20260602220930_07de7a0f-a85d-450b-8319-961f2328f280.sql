-- Reativa automaticamente um produto no estoque (pos_products)
-- sempre que ele passar a ter estoque > 0, em qualquer fluxo (balanço,
-- entrada, devolução, sync). Não interfere na inativação por estoque zero.
CREATE OR REPLACE FUNCTION public.reactivate_pos_product_on_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.stock, 0) > 0 AND NEW.is_active = false THEN
    NEW.is_active := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reactivate_pos_product_on_stock ON public.pos_products;
CREATE TRIGGER trg_reactivate_pos_product_on_stock
BEFORE INSERT OR UPDATE OF stock ON public.pos_products
FOR EACH ROW
EXECUTE FUNCTION public.reactivate_pos_product_on_stock();