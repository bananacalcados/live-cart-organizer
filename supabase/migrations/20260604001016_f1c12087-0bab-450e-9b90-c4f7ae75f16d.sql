-- 1) pos_stores: remove anon read (Tiny token exposure)
DROP POLICY IF EXISTS "pos_stores_anon_select" ON public.pos_stores;
REVOKE ALL ON public.pos_stores FROM anon;

-- 2) orders: remove unrestricted anon update on unpaid orders
DROP POLICY IF EXISTS "Anon update checkout fields on unpaid orders" ON public.orders;
REVOKE ALL ON public.orders FROM anon;

-- 3) customer_registrations: remove unrestricted anon insert/update of PII
DROP POLICY IF EXISTS "Public insert customer_registrations" ON public.customer_registrations;
DROP POLICY IF EXISTS "Public insert customer_registrations for checkout" ON public.customer_registrations;
DROP POLICY IF EXISTS "Public update customer_registrations for checkout" ON public.customer_registrations;
REVOKE ALL ON public.customer_registrations FROM anon;
