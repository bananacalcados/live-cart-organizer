BEGIN;

SELECT 1 / CASE WHEN public.vip_photo_internal_name(
  'Foto de Scarpin Cecília Couro Napa na cor Café', NULL
) = 'Scarpin Cecília Couro Napa Café' THEN 1 ELSE 0 END AS legacy_name;

SELECT 1 / CASE WHEN public.vip_photo_internal_name(
  'Foto de outro produto na cor Preto', 'Scarpin Cecília Couro Napa Café'
) = 'Scarpin Cecília Couro Napa Café' THEN 1 ELSE 0 END AS exact_catalog_title;

SELECT 1 / CASE WHEN public.vip_photo_internal_name(NULL, NULL)
  IS NULL THEN 1 ELSE 0 END AS absent_name;

DO $$
DECLARE
  v_campaign uuid;
  v_row public.group_campaign_scheduled_messages%ROWTYPE;
BEGIN
  SELECT id INTO v_campaign FROM public.group_campaigns WHERE name ILIKE 'Teste%' ORDER BY id LIMIT 1;
  IF v_campaign IS NULL THEN RAISE EXCEPTION 'Test requires an existing campaign'; END IF;
  INSERT INTO public.group_campaign_scheduled_messages (
    campaign_id, message_type, status, scheduled_at, media_brief, message_content
  ) VALUES (
    v_campaign, 'image', 'draft', '2099-01-01 12:00:00+00',
    'Foto de Scarpin Cecília Couro Napa na cor Café', NULL
  ) RETURNING * INTO v_row;
  IF v_row.media_brief IS DISTINCT FROM 'Scarpin Cecília Couro Napa Café' THEN
    RAISE EXCEPTION 'Photo name was not normalized';
  END IF;
  IF v_row.message_content IS NOT NULL THEN
    RAISE EXCEPTION 'Internal photo name leaked into empty caption';
  END IF;
  IF v_row.status <> 'draft' OR v_row.scheduled_at IS DISTINCT FROM '2099-01-01 12:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'Photo normalization changed scheduling';
  END IF;
END;
$$;

ROLLBACK;