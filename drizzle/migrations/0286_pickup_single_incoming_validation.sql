CREATE OR REPLACE FUNCTION public.support_auto_detect_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  IF NEW.channel='instagram' AND coalesce(NEW.message,'') LIKE '💬 Comentário%' THEN RETURN NULL; END IF;
  BEGIN
    IF NEW.direction='incoming' AND NEW.is_group IS NOT TRUE AND NEW.source IS DISTINCT FROM 'instagram_backfill' AND public.pickup_shipping_question(NEW.message) THEN
      PERFORM public.invalidate_pickup_on_shipping_question(NEW.phone,NEW.created_at);
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'pickup_invalidation: %',SQLERRM; END;
  BEGIN
    IF coalesce(NEW.media_type,'') !~* '^(sticker|reaction|reacao|figurinha)$' THEN
      PERFORM public.support_ai_enqueue(NEW.id,NEW.phone,NEW.whatsapp_number_id,NEW.channel,NEW.message);
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'support_auto_detect: %',SQLERRM;
  END;
  RETURN NULL;
END $function$;