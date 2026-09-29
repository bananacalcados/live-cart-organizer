REVOKE EXECUTE ON FUNCTION public.meta_ads_campaign_group(text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.meta_ads_campaign_group(text,text) TO authenticated, service_role;