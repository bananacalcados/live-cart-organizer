UPDATE public.products_master
SET ncm = '64039900', updated_at = now()
WHERE ncm IS NULL OR ncm = '' OR ncm = '00000000';