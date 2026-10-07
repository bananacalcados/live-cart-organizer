DROP INDEX IF EXISTS public.instagram_customer_links_uq;
CREATE UNIQUE INDEX instagram_customer_links_ig_phone_uq ON public.instagram_customer_links (ig_user_id, phone);