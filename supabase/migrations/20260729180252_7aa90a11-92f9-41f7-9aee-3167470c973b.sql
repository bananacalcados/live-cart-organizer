WITH z AS (
  SELECT right(regexp_replace(zc.phone, '\D', '', 'g'), 8) AS suffix8,
         MIN(COALESCE(zc.first_purchase_at, zc.last_purchase_at, zc.zoppy_created_at, zc.created_at)) AS legacy_first
  FROM public.zoppy_customers zc
  WHERE COALESCE(zc.total_orders, 0) > 0
    AND COALESCE(zc.first_purchase_at, zc.last_purchase_at, zc.zoppy_created_at, zc.created_at) IS NOT NULL
    AND length(regexp_replace(zc.phone, '\D', '', 'g')) >= 10
  GROUP BY 1
)
UPDATE public.customers_unified cu
SET first_purchase_at = z.legacy_first,
    updated_at = now()
FROM z
WHERE cu.phone_suffix8 = z.suffix8
  AND (cu.first_purchase_at IS NULL OR cu.first_purchase_at > z.legacy_first);