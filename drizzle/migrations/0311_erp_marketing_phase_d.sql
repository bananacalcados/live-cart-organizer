INSERT INTO public.app_settings (key, value) VALUES ('product_source_marketing', '"shopify"'::jsonb) ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.link_page_catalog_products ADD COLUMN IF NOT EXISTS erp_master_id uuid;

CREATE OR REPLACE FUNCTION public.vip_product_destination(p_master uuid, p_color text DEFAULT NULL)
RETURNS TABLE(message_text text, dest_number_id uuid, provider text, phone_display text, wasender_phone_number text, uazapi_owner text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH pm AS (SELECT name FROM public.products_master WHERE id = p_master),
  c AS (
    SELECT v.color FROM public.product_variants v
     WHERE v.master_id = p_master AND v.is_active AND p_color IS NOT NULL
       AND lower(trim(v.color)) = lower(trim(p_color)) LIMIT 1
  ),
  dd AS (
    SELECT d.whatsapp_number_id FROM public.vip_link_daily_destination d
     WHERE d.day = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    UNION ALL
    SELECT * FROM (SELECT d2.whatsapp_number_id FROM public.vip_link_daily_destination d2 ORDER BY d2.day DESC LIMIT 1) x
    LIMIT 1
  )
  SELECT 'Oi! Vi o *' || pm.name || '*' || coalesce(' na cor ' || (SELECT color FROM c), '') || ' e quero saber mais 😊',
         n.id, n.provider, n.phone_display, n.wasender_phone_number, n.uazapi_owner
    FROM pm
    LEFT JOIN dd ON true
    LEFT JOIN public.whatsapp_numbers n ON n.id = dd.whatsapp_number_id;
$$;
REVOKE EXECUTE ON FUNCTION public.vip_product_destination(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vip_product_destination(uuid, text) TO service_role;