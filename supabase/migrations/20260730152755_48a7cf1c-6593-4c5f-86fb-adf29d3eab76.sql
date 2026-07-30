GRANT EXECUTE ON FUNCTION public.get_or_create_customer_access_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_access_code(text, text) TO authenticated;