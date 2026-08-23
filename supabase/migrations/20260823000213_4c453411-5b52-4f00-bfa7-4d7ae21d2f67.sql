CREATE OR REPLACE FUNCTION public.sync_event_lead_to_lp_leads()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag text;
BEGIN
  v_tag := 'event_lead:' || NEW.event_id::text;

  IF EXISTS (
    SELECT 1 FROM public.lp_leads
    WHERE campaign_tag = v_tag AND phone = NEW.phone
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.lp_leads (
    campaign_tag, name, phone, source, metadata, created_at
  ) VALUES (
    v_tag,
    NEW.name,
    NEW.phone,
    'event_' || NEW.source,
    jsonb_build_object(
      'event_id', NEW.event_id,
      'event_lead_id', NEW.id,
      'landing_page_id', NEW.landing_page_id,
      'typebot_id', NEW.typebot_id,
      'referral_token', NEW.referral_token,
      'referred_by_lead_id', NEW.referred_by_lead_id,
      'utm_source', NEW.utm_source,
      'utm_medium', NEW.utm_medium,
      'utm_campaign', NEW.utm_campaign,
      'utm_content', NEW.utm_content,
      'utm_term', NEW.utm_term,
      'link_tag', NEW.link_tag,
      'link_slug', NEW.link_slug
    ),
    NEW.created_at
  );

  RETURN NEW;
END;
$function$;