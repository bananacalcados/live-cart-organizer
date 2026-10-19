CREATE FUNCTION public.vip_photo_internal_name(p_brief text, p_product_title text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_product_title IS NOT NULL AND btrim(p_product_title) <> '' THEN p_product_title
    ELSE replace(regexp_replace(p_brief, '^Foto de ', ''), ' na cor ', ' ')
  END;
$$;

CREATE FUNCTION public.normalize_vip_photo_internal_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.media_brief := public.vip_photo_internal_name(NEW.media_brief, NEW.vip_link_product->>'title');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vip_photo_internal_name
BEFORE INSERT ON public.group_campaign_scheduled_messages
FOR EACH ROW
WHEN (NEW.message_type = 'image')
EXECUTE FUNCTION public.normalize_vip_photo_internal_name();

COMMENT ON FUNCTION public.normalize_vip_photo_internal_name() IS 'Normalizes only internal photo labels on creation, including external draft writers; never changes captions or scheduling.';