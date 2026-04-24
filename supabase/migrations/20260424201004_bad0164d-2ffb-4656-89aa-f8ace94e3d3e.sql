DELETE FROM public.meta_capi_offline_log l
USING public.pos_sales s
LEFT JOIN public.pos_customers c ON c.id = s.customer_id
WHERE l.sale_id = s.id
  AND l.event_name = 'Purchase'
  AND l.status = 'skipped'
  AND (
    COALESCE(c.whatsapp,'') != ''
    OR COALESCE(c.email,'') != ''
    OR COALESCE(c.cpf,'') != ''
    OR COALESCE(s.customer_phone,'') != ''
  );