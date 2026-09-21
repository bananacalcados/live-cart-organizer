ALTER TABLE public.pos_sale_items
  ADD COLUMN IF NOT EXISTS expedition_conference_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expedition_waiting_qty numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pos_sale_items.expedition_conference_qty IS 'Quantidade deste item movida manualmente para Conferência';
COMMENT ON COLUMN public.pos_sale_items.expedition_waiting_qty IS 'Quantidade deste item movida manualmente para Aguardando';

UPDATE public.pos_sale_items i
SET
  expedition_conference_qty = CASE
    WHEN s.expedition_stage = 'conferencia' AND COALESCE(s.expedition_waiting_products, false)
      THEN LEAST(COALESCE(i.quantity, 0), GREATEST(COALESCE(i.expedition_picked_qty, 0), 0))
    WHEN s.expedition_stage = 'conferencia'
      THEN COALESCE(i.quantity, 0)
    WHEN s.expedition_stage = 'aguardando'
      THEN LEAST(COALESCE(i.quantity, 0), GREATEST(COALESCE(i.expedition_picked_qty, 0), 0))
    ELSE 0
  END,
  expedition_waiting_qty = CASE
    WHEN s.expedition_stage = 'aguardando'
      THEN GREATEST(COALESCE(i.quantity, 0) - COALESCE(i.expedition_picked_qty, 0), 0)
    ELSE 0
  END
FROM public.pos_sales s
WHERE s.id = i.sale_id
  AND s.expedition_stage IN ('separacao', 'aguardando', 'conferencia');

UPDATE public.pos_sale_items
SET expedition_picked_qty = LEAST(
  COALESCE(quantity, 0),
  COALESCE(expedition_conference_qty, 0) + COALESCE(expedition_waiting_qty, 0)
)
WHERE expedition_conference_qty > 0 OR expedition_waiting_qty > 0;