
-- Function: replicate event_leads to lp_leads
CREATE OR REPLACE FUNCTION public.sync_event_lead_to_lp_leads()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag text;
BEGIN
  v_tag := 'event_lead:' || NEW.event_id::text;

  -- Avoid duplicates (same campaign_tag + phone)
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
      'utm_campaign', NEW.utm_campaign
    ),
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

-- Trigger
DROP TRIGGER IF EXISTS trg_sync_event_lead_to_lp_leads ON public.event_leads;
CREATE TRIGGER trg_sync_event_lead_to_lp_leads
AFTER INSERT ON public.event_leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_event_lead_to_lp_leads();

-- Backfill existing event_leads into lp_leads
INSERT INTO public.lp_leads (campaign_tag, name, phone, source, metadata, created_at)
SELECT
  'event_lead:' || el.event_id::text,
  el.name,
  el.phone,
  'event_' || el.source,
  jsonb_build_object(
    'event_id', el.event_id,
    'event_lead_id', el.id,
    'landing_page_id', el.landing_page_id,
    'typebot_id', el.typebot_id,
    'referral_token', el.referral_token,
    'referred_by_lead_id', el.referred_by_lead_id,
    'utm_source', el.utm_source,
    'utm_medium', el.utm_medium,
    'utm_campaign', el.utm_campaign
  ),
  el.created_at
FROM public.event_leads el
WHERE NOT EXISTS (
  SELECT 1 FROM public.lp_leads l
  WHERE l.campaign_tag = 'event_lead:' || el.event_id::text
    AND l.phone = el.phone
);
