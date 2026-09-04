DROP INDEX IF EXISTS public.idx_customers_whatsapp_suffix8;
DROP INDEX IF EXISTS public.idx_customer_registrations_whatsapp_suffix8;
DROP INDEX IF EXISTS public.idx_chat_contacts_phone_suffix8;

CREATE INDEX idx_customers_whatsapp_suffix8
  ON public.customers ((right(regexp_replace(coalesce(whatsapp,''), '\D', '', 'g'), 8)));
CREATE INDEX idx_customer_registrations_whatsapp_suffix8
  ON public.customer_registrations ((right(regexp_replace(coalesce(whatsapp,''), '\D', '', 'g'), 8)));
CREATE INDEX idx_chat_contacts_phone_suffix8
  ON public.chat_contacts ((right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 8)));

ANALYZE public.customers;
ANALYZE public.customer_registrations;
ANALYZE public.chat_contacts;