CREATE OR REPLACE VIEW public.v_live_shown_products AS
SELECT s.id, s.event_id, s.code, s.shown_at, s.shown_by, s.source, s.is_current,
       v.product_name, v.color, v.category, v.sale_price, v.total_stock, v.shopify_ok, v.shopify_status,
       s.stopped_at
FROM public.live_shown_products s
JOIN public.v_product_color_codes v ON v.code = s.code;