WITH code_status AS (
  SELECT
    c.id,
    COUNT(v.id) AS n_var,
    COUNT(sm.shopify_variant_id) FILTER (
      WHERE sm.product_status = 'ACTIVE' AND sm.published_lovable
    ) AS n_ok
  FROM public.product_color_codes c
  JOIN public.products_master m ON m.id = c.master_id
  LEFT JOIN public.product_variants v
    ON v.master_id = c.master_id
   AND lower(trim(coalesce(v.color, ''))) = c.color_key
   AND v.is_active
  LEFT JOIN public.shopify_variant_mirror sm
    ON sm.shopify_variant_id = v.shopify_variant_id
  WHERE c.id = 'b0e45bf2-cf11-4baa-a525-36417dc95d8c'
    AND c.code = 'T264'
    AND c.master_id = '3c0df6f2-f344-453e-beb4-e282a4bfe34e'
    AND m.shopify_product_id = '10366331715641'
  GROUP BY c.id
)
UPDATE public.product_color_codes p
SET shopify_ok = true,
    shopify_status = 'ok',
    shopify_sizes_ok = s.n_ok,
    shopify_sizes_total = s.n_var,
    shopify_checked_at = now()
FROM code_status s
WHERE p.id = s.id
  AND s.n_var = 6
  AND s.n_ok = 6;