
-- Add unique constraint for OFX upsert (prevent duplicate transactions)
CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_account_fitid_key ON public.bank_transactions (bank_account_id, fitid) WHERE fitid IS NOT NULL;
