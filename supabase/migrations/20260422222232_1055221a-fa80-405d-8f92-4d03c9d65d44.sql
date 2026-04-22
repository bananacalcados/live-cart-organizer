UPDATE public.whatsapp_numbers
SET access_token = (
  SELECT access_token FROM public.whatsapp_numbers
  WHERE label = 'Meta Centro' AND provider = 'meta'
  LIMIT 1
),
updated_at = now()
WHERE label = 'Ravena' AND provider = 'meta';