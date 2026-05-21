-- Deactivate duplicate active followups, keeping only the most recent per order_id
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY order_id ORDER BY created_at DESC, reminder_level DESC) AS rn
  FROM public.livete_followups
  WHERE is_active = true AND order_id IS NOT NULL
)
UPDATE public.livete_followups f
SET is_active = false,
    completed_at = now(),
    updated_at = now()
FROM ranked r
WHERE f.id = r.id AND r.rn > 1;

-- Prevent future duplicates: only one active followup per order
CREATE UNIQUE INDEX IF NOT EXISTS livete_followups_one_active_per_order
ON public.livete_followups (order_id)
WHERE is_active = true AND order_id IS NOT NULL;