-- ============================================
-- 1. Tabela de erros de espelhamento Tiny
-- ============================================
CREATE TABLE IF NOT EXISTS public.tiny_stock_sync_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.pos_products(id) ON DELETE SET NULL,
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  tiny_id bigint,
  sku text,
  attempted_stock numeric,
  direction text,
  quantity numeric,
  sale_event text,
  error_message text,
  attempts int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'abandoned' | 'resolved'
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tiny_stock_sync_errors_unresolved
  ON public.tiny_stock_sync_errors(created_at)
  WHERE resolved_at IS NULL AND status = 'pending';

ALTER TABLE public.tiny_stock_sync_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage tiny_stock_sync_errors" ON public.tiny_stock_sync_errors;
CREATE POLICY "admins manage tiny_stock_sync_errors"
  ON public.tiny_stock_sync_errors
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- 2. Colunas em pos_stock_adjustments
-- ============================================
ALTER TABLE public.pos_stock_adjustments
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_event text,
  ADD COLUMN IF NOT EXISTS tiny_mirrored_at timestamptz,
  ADD COLUMN IF NOT EXISTS tiny_mirror_status text;

CREATE UNIQUE INDEX IF NOT EXISTS pos_stock_adjustments_sale_idem
  ON public.pos_stock_adjustments(sale_id, product_id, sale_event)
  WHERE sale_id IS NOT NULL;

-- ============================================
-- 3. Função do trigger
-- ============================================
CREATE OR REPLACE FUNCTION public.apply_pos_sale_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_item record;
  v_product record;
  v_target_store uuid;
  v_new_stock numeric;
  v_event text;
  v_direction text;
  v_reason text;
  v_qty_signed numeric;
  v_adj_id uuid;
  v_payload jsonb;
  v_items jsonb := '[]'::jsonb;
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      v_event := 'sale'; v_direction := 'out'; v_reason := 'pos_sale';
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' AND COALESCE(OLD.status, '') <> 'completed' THEN
      v_event := 'sale'; v_direction := 'out'; v_reason := 'pos_sale';
    ELSIF NEW.status = 'cancelled' AND COALESCE(OLD.status, '') <> 'cancelled' THEN
      v_event := 'cancel'; v_direction := 'in'; v_reason := 'sale_cancelled';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  v_target_store := COALESCE(NEW.stock_source_store_id, NEW.store_id);
  IF v_target_store IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_event = 'cancel'
     AND NOT EXISTS (
       SELECT 1 FROM public.pos_stock_adjustments
       WHERE sale_id = NEW.id AND sale_event = 'sale'
     ) THEN
    RETURN NEW;
  END IF;

  FOR v_item IN
    SELECT sku, barcode, quantity, product_name
    FROM public.pos_sale_items
    WHERE sale_id = NEW.id
  LOOP
    SELECT id, stock, sku, barcode, tiny_id INTO v_product
    FROM public.pos_products
    WHERE store_id = v_target_store
      AND (
        (v_item.barcode IS NOT NULL AND v_item.barcode <> '' AND barcode = v_item.barcode)
        OR (v_item.sku IS NOT NULL AND v_item.sku <> '' AND sku = v_item.sku)
      )
    ORDER BY (CASE WHEN v_item.barcode IS NOT NULL AND barcode = v_item.barcode THEN 0 ELSE 1 END)
    LIMIT 1;

    IF v_product.id IS NULL THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.pos_stock_adjustments
      WHERE sale_id = NEW.id AND product_id = v_product.id AND sale_event = v_event
    ) THEN
      CONTINUE;
    END IF;

    v_qty_signed := CASE WHEN v_direction = 'out' THEN -v_item.quantity ELSE v_item.quantity END;
    v_new_stock := COALESCE(v_product.stock, 0) + v_qty_signed;

    UPDATE public.pos_products
       SET stock = v_new_stock, updated_at = now()
     WHERE id = v_product.id;

    INSERT INTO public.pos_stock_adjustments(
      store_id, product_id, tiny_id, sku, barcode, product_name,
      direction, quantity, previous_stock, new_stock, reason,
      seller_id, sale_id, sale_event, tiny_mirror_status
    ) VALUES (
      v_target_store, v_product.id, v_product.tiny_id, v_product.sku, v_product.barcode,
      COALESCE(v_item.product_name, ''),
      v_direction, v_item.quantity, COALESCE(v_product.stock, 0), v_new_stock, v_reason,
      NEW.seller_id, NEW.id, v_event,
      CASE WHEN v_product.tiny_id IS NOT NULL THEN 'pending' ELSE NULL END
    ) RETURNING id INTO v_adj_id;

    IF v_product.tiny_id IS NOT NULL THEN
      v_items := v_items || jsonb_build_object(
        'adjustment_id', v_adj_id,
        'product_id',    v_product.id,
        'tiny_id',       v_product.tiny_id,
        'sku',           v_product.sku,
        'new_stock',     v_new_stock,
        'quantity',      v_item.quantity,
        'direction',     v_direction
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_items) > 0 THEN
    v_payload := jsonb_build_object(
      'sale_id',    NEW.id,
      'store_id',   v_target_store,
      'sale_event', v_event,
      'items',      v_items
    );

    PERFORM net.http_post(
      url     := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/tiny-mirror-stock',
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'apikey', v_anon_key,
                   'Authorization','Bearer '||v_anon_key
                 ),
      body    := v_payload
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sales_stock_movement ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_stock_movement
  AFTER INSERT OR UPDATE OF status ON public.pos_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_pos_sale_stock_movement();