ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_type text;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_orders_shipping_type;
ALTER TABLE public.orders ADD CONSTRAINT chk_orders_shipping_type CHECK (shipping_type IS NULL OR shipping_type IN ('sedex','correios','transportadora'));

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS shipping_type text;
ALTER TABLE public.pos_sales DROP CONSTRAINT IF EXISTS chk_pos_sales_shipping_type;
ALTER TABLE public.pos_sales ADD CONSTRAINT chk_pos_sales_shipping_type CHECK (shipping_type IS NULL OR shipping_type IN ('sedex','correios','transportadora'));

-- 1) Manter is_sedex <-> shipping_type consistentes no pedido (orders)
CREATE OR REPLACE FUNCTION public.orders_sync_shipping_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.shipping_type IS NOT NULL THEN
      NEW.is_sedex := (NEW.shipping_type = 'sedex');
    ELSIF COALESCE(NEW.is_sedex, false) THEN
      NEW.shipping_type := 'sedex';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.shipping_type IS DISTINCT FROM OLD.shipping_type THEN
    NEW.is_sedex := (NEW.shipping_type = 'sedex');
  ELSIF NEW.is_sedex IS DISTINCT FROM OLD.is_sedex THEN
    NEW.shipping_type := CASE WHEN NEW.is_sedex THEN 'sedex' ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_shipping_type ON public.orders;
CREATE TRIGGER trg_orders_sync_shipping_type
BEFORE INSERT OR UPDATE OF shipping_type, is_sedex ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_sync_shipping_type();

-- 2) Mesma consistência na venda do PDV (pos_sales) — ex: botão MARCAR SEDEX da Expedição
CREATE OR REPLACE FUNCTION public.pos_sales_sync_shipping_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.shipping_type IS NOT NULL THEN
      NEW.is_sedex := (NEW.shipping_type = 'sedex');
    ELSIF COALESCE(NEW.is_sedex, false) THEN
      NEW.shipping_type := 'sedex';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.shipping_type IS DISTINCT FROM OLD.shipping_type THEN
    NEW.is_sedex := (NEW.shipping_type = 'sedex');
  ELSIF NEW.is_sedex IS DISTINCT FROM OLD.is_sedex THEN
    NEW.shipping_type := CASE WHEN NEW.is_sedex THEN 'sedex' ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sales_sync_shipping_type ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_sync_shipping_type
BEFORE INSERT OR UPDATE OF shipping_type, is_sedex ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.pos_sales_sync_shipping_type();

-- 3) Venda criada a partir de pedido já herda o tipo de envio
CREATE OR REPLACE FUNCTION public.pos_sales_apply_sedex_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_order_id IS NOT NULL THEN
    SELECT COALESCE(o.is_sedex, false), o.shipping_type
      INTO NEW.is_sedex, NEW.shipping_type
    FROM public.orders o WHERE o.id = NEW.source_order_id;
    NEW.is_sedex := COALESCE(NEW.is_sedex, false);
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Propagação pedido -> venda cobre também o tipo de envio
CREATE OR REPLACE FUNCTION public.orders_propagate_sedex_to_pos_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pos_sales s
     SET is_sedex = COALESCE(NEW.is_sedex, false),
         shipping_type = NEW.shipping_type
   WHERE (s.source_order_id = NEW.id OR s.id = NEW.pos_sale_id)
     AND (COALESCE(s.is_sedex, false) IS DISTINCT FROM COALESCE(NEW.is_sedex, false)
          OR s.shipping_type IS DISTINCT FROM NEW.shipping_type);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_propagate_sedex_pos ON public.orders;
CREATE TRIGGER trg_orders_propagate_sedex_pos
AFTER UPDATE OF is_sedex, shipping_type ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_propagate_sedex_to_pos_sales();

-- 5) Backfill: pedidos SEDEX viram shipping_type='sedex' e vendas herdam do pedido
UPDATE public.orders SET shipping_type = 'sedex' WHERE is_sedex AND shipping_type IS NULL;

UPDATE public.pos_sales s
   SET shipping_type = o.shipping_type, is_sedex = COALESCE(o.is_sedex, false)
  FROM public.orders o
 WHERE (s.source_order_id = o.id OR s.id = o.pos_sale_id)
   AND o.shipping_type IS NOT NULL
   AND s.shipping_type IS DISTINCT FROM o.shipping_type;

UPDATE public.pos_sales SET shipping_type = 'sedex' WHERE is_sedex AND shipping_type IS NULL;