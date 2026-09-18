WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY flow_id ORDER BY step_order, created_at, id) AS rn
  FROM public.automation_steps
)
UPDATE public.automation_steps s
SET step_order = -r.rn
FROM ranked r
WHERE s.id = r.id;

UPDATE public.automation_steps
SET step_order = -step_order
WHERE step_order < 0;

CREATE UNIQUE INDEX IF NOT EXISTS automation_steps_flow_order_uniq
  ON public.automation_steps (flow_id, step_order);