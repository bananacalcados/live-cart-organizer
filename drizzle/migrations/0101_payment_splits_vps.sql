ALTER TABLE public.payment_splits DROP CONSTRAINT payment_splits_method_check;
ALTER TABLE public.payment_splits ADD CONSTRAINT payment_splits_method_check CHECK (method IN ('pix','credit','debit','vps'));
ALTER TABLE public.payment_splits DROP CONSTRAINT payment_splits_seq_check;
ALTER TABLE public.payment_splits ADD CONSTRAINT payment_splits_seq_check CHECK (seq BETWEEN 1 AND 6);
ALTER TABLE public.payment_splits ADD COLUMN IF NOT EXISTS vps_reference text;
ALTER TABLE public.payment_splits ADD COLUMN IF NOT EXISTS vps_confirmed_by uuid;
ALTER TABLE public.payment_splits ADD COLUMN IF NOT EXISTS vps_confirmed_at timestamptz;