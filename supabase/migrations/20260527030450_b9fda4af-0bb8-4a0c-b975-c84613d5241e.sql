
ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_bank_account_id_fkey;

ALTER TABLE public.bank_transactions
  ALTER COLUMN bank_account_id DROP NOT NULL;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_bank_account_id_fkey
  FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.cash_flow_entries
  DROP CONSTRAINT IF EXISTS cash_flow_entries_bank_account_id_fkey;

ALTER TABLE public.cash_flow_entries
  ADD CONSTRAINT cash_flow_entries_bank_account_id_fkey
  FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
