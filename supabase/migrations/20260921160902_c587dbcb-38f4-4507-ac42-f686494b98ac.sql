ALTER TABLE public.pos_sale_items
  ADD COLUMN IF NOT EXISTS expedition_completed_qty numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pos_sale_items.expedition_completed_qty IS 'Quantidade deste item já conferida e concluída na expedição';

UPDATE public.pos_sale_items i
SET expedition_completed_qty = COALESCE(i.quantity, 0)
FROM public.pos_sales s
WHERE s.id = i.sale_id
  AND s.expedition_stage = 'concluido'
  AND COALESCE(i.expedition_completed_qty, 0) = 0;