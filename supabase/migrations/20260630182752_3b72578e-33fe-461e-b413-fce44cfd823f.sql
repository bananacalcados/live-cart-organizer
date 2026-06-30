UPDATE public.events
SET channel_preference = 'meta_whatsapp',
    channel_preferences = ARRAY['meta_whatsapp']
WHERE whatsapp_number_id IN (SELECT id FROM public.whatsapp_numbers WHERE provider = 'meta')
  AND meta_template_name IS NOT NULL
  AND (channel_preference IS DISTINCT FROM 'meta_whatsapp' OR channel_preferences IS NULL OR array_length(channel_preferences,1) IS NULL);