CREATE OR REPLACE FUNCTION public.mirror_pos_product_cost_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barcode text;
  v_cost numeric;
  v_price numeric;
BEGIN
  -- Evita recursão em cadeia (o próprio UPDATE deste trigger dispararia o trigger de novo)
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  v_barcode := NULLIF(TRIM(NEW.barcode), '');
  IF v_barcode IS NULL THEN
    RETURN NEW;
  END IF;

  v_cost  := NEW.cost_price;
  v_price := NEW.price;

  -- Nada para espelhar se ambos estão vazios/zerados
  IF (v_cost IS NULL OR v_cost <= 0) AND (v_price IS NULL OR v_price <= 0) THEN
    RETURN NEW;
  END IF;

  -- Espelha CUSTO nas demais lojas com mesmo código de barras que estejam zeradas
  IF v_cost IS NOT NULL AND v_cost > 0 THEN
    UPDATE public.pos_products p
       SET cost_price = v_cost,
           updated_at = now()
     WHERE p.barcode = v_barcode
       AND p.id <> NEW.id
       AND (p.cost_price IS NULL OR p.cost_price <= 0);
  END IF;

  -- Espelha PREÇO DE VENDA nas demais lojas com mesmo código de barras que estejam zeradas
  IF v_price IS NOT NULL AND v_price > 0 THEN
    UPDATE public.pos_products p
       SET price = v_price,
           updated_at = now()
     WHERE p.barcode = v_barcode
       AND p.id <> NEW.id
       AND (p.price IS NULL OR p.price <= 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_pos_product_cost_price ON public.pos_products;

CREATE TRIGGER trg_mirror_pos_product_cost_price
AFTER INSERT OR UPDATE OF cost_price, price ON public.pos_products
FOR EACH ROW
EXECUTE FUNCTION public.mirror_pos_product_cost_price();