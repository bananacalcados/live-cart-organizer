SELECT setval(
  'public.customer_code_seq',
  GREATEST(
    (SELECT COALESCE(MAX((regexp_replace(customer_code,'\D','','g'))::bigint), 0)
       FROM public.customers_unified
      WHERE customer_code ~ '^BC-\d+$'),
    (SELECT last_value FROM public.customer_code_seq)
  ) + 10,
  true
);