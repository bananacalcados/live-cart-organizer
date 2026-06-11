CREATE TABLE public.product_wait_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  customer_name text,
  whatsapp_number_id uuid,
  store_id uuid,
  pos_product_id uuid,
  matched_pos_product_id uuid,
  product_name text NOT NULL,
  size text,
  color text,
  barcode text,
  parent_sku text,
  image_url text,
  requested_by_user_id uuid,
  requested_by_name text,
  status text NOT NULL DEFAULT 'waiting',
  notes text,
  arrived_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_wait_notifications TO authenticated;
GRANT ALL ON public.product_wait_notifications TO service_role;

ALTER TABLE public.product_wait_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "POS module can manage product wait notifications"
ON public.product_wait_notifications
FOR ALL
USING (has_module_access(auth.uid(), 'pos'::text))
WITH CHECK (has_module_access(auth.uid(), 'pos'::text));

CREATE INDEX idx_pwn_status_barcode ON public.product_wait_notifications (status, barcode);
CREATE INDEX idx_pwn_status_variation ON public.product_wait_notifications (status, parent_sku, size, color);
CREATE INDEX idx_pwn_phone ON public.product_wait_notifications (phone);

CREATE TRIGGER update_pwn_updated_at
BEFORE UPDATE ON public.product_wait_notifications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Detecta reposição: quando estoque sai de 0 (ou negativo) para positivo,
-- marca como "chegou" todos os clientes que aguardam aquela variação exata.
CREATE OR REPLACE FUNCTION public.notify_product_wait_on_restock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock IS NOT NULL AND NEW.stock > 0 AND COALESCE(OLD.stock, 0) <= 0 THEN
    UPDATE public.product_wait_notifications w
    SET status = 'arrived',
        arrived_at = now(),
        matched_pos_product_id = NEW.id,
        updated_at = now()
    WHERE w.status = 'waiting'
      AND (
        (NULLIF(w.barcode, '') IS NOT NULL AND w.barcode = NEW.barcode)
        OR (
          NULLIF(w.barcode, '') IS NULL
          AND lower(coalesce(w.parent_sku, '')) = lower(coalesce(NEW.parent_sku, ''))
          AND lower(coalesce(w.size, '')) = lower(coalesce(NEW.size, ''))
          AND lower(coalesce(w.color, '')) = lower(coalesce(NEW.color, ''))
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_product_wait_on_restock
AFTER INSERT OR UPDATE OF stock ON public.pos_products
FOR EACH ROW EXECUTE FUNCTION public.notify_product_wait_on_restock();

ALTER PUBLICATION supabase_realtime ADD TABLE public.product_wait_notifications;