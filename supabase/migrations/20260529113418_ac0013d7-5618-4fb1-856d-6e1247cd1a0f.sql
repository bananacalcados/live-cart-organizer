GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_cash_registers TO authenticated;
GRANT ALL ON public.pos_cash_registers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_cash_movements TO authenticated;
GRANT ALL ON public.pos_cash_movements TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_payment_receipts TO authenticated;
GRANT ALL ON public.pos_payment_receipts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;