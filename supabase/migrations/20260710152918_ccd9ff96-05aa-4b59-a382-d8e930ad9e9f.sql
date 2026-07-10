-- 1. Deduplicate existing dispatch_recipients: keep the "best" row per (dispatch_id, phone)
DELETE FROM public.dispatch_recipients dr
USING (
  SELECT id,
    row_number() OVER (
      PARTITION BY dispatch_id, phone
      ORDER BY
        CASE status
          WHEN 'read' THEN 5
          WHEN 'delivered' THEN 4
          WHEN 'sent' THEN 3
          WHEN 'blocked' THEN 2
          WHEN 'failed' THEN 1
          ELSE 0
        END DESC,
        created_at ASC
    ) AS rn
  FROM public.dispatch_recipients
) d
WHERE dr.id = d.id AND d.rn > 1;

-- 2. Unique guard: the same phone can never be enqueued twice within one dispatch.
--    Any re-save / edit / double-click that tries to re-insert the same list will
--    now be rejected by the database instead of silently duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_recipients_dispatch_phone
  ON public.dispatch_recipients (dispatch_id, phone);