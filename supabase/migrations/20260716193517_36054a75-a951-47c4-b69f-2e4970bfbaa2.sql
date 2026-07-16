DO $$
DECLARE
  v_deleted integer := 0;
BEGIN
  WITH orphans AS (
    SELECT m.id
    FROM public.products_master m
    WHERE NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.master_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM public.product_master_data d WHERE d.parent_sku = m.sku_root)
      AND NOT EXISTS (SELECT 1 FROM public.pos_products p WHERE p.parent_sku = m.sku_root)
      AND NOT EXISTS (SELECT 1 FROM public.purchase_invoice_items i WHERE i.master_id = m.id)
  ), deleted AS (
    DELETE FROM public.products_master WHERE id IN (SELECT id FROM orphans)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  INSERT INTO public.catalog_sync_log (run_id, operation, details)
  VALUES (gen_random_uuid(), 'cleanup_orphan_masters', jsonb_build_object('deleted', v_deleted, 'run_at', now()));
END $$;