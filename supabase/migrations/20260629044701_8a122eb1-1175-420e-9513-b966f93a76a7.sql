-- 1) Add store + instance columns to chat_awaiting_payment (nullable, additive)
ALTER TABLE public.chat_awaiting_payment
  ADD COLUMN IF NOT EXISTS store_id uuid,
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid;

-- 2) Backfill store_id from the related sale.
--    For live sales, fall back to the event's default store.
UPDATE public.chat_awaiting_payment a
SET store_id = COALESCE(s.store_id, e.default_store_id)
FROM public.pos_sales s
LEFT JOIN public.events e ON e.id = s.event_id
WHERE a.sale_id = s.id
  AND a.store_id IS NULL;

-- 3) Backfill whatsapp_number_id from the instance of the latest real message
--    for that phone (the conversation where the history actually lives).
UPDATE public.chat_awaiting_payment a
SET whatsapp_number_id = lm.whatsapp_number_id
FROM (
  SELECT DISTINCT ON (m.phone) m.phone, m.whatsapp_number_id
  FROM public.whatsapp_messages m
  WHERE m.whatsapp_number_id IS NOT NULL
  ORDER BY m.phone, m.created_at DESC
) lm
WHERE a.whatsapp_number_id IS NULL
  AND regexp_replace(a.phone, '\D', '', 'g') = regexp_replace(lm.phone, '\D', '', 'g');