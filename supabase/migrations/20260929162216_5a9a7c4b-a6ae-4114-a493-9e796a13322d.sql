REVOKE EXECUTE ON FUNCTION public.redeem_order_cashback_on_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.available_cashbacks_for_order(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cashback_return_stats(int) FROM PUBLIC, anon;