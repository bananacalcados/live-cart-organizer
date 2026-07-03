ALTER TABLE public.pos_stock_adjustments
  DROP CONSTRAINT pos_stock_adjustments_product_id_fkey,
  ADD CONSTRAINT pos_stock_adjustments_product_id_fkey
    FOREIGN KEY (product_id)
    REFERENCES public.pos_products(id)
    ON DELETE CASCADE;