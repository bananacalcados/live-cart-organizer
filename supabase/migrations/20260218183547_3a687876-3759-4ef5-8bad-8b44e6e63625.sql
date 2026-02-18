
-- Add store_id to bank_accounts to link to pos_stores (empresa)
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.pos_stores(id);

-- Financial categories (synced from Tiny + custom)
CREATE TABLE public.financial_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.financial_categories(id),
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense', 'transfer')),
  tiny_category_id TEXT,
  is_custom BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_financial_categories_tiny ON public.financial_categories(tiny_category_id) WHERE tiny_category_id IS NOT NULL;

-- Bank transactions (imported from OFX)
CREATE TABLE public.bank_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id),
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  memo TEXT,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL DEFAULT 'debit' CHECK (type IN ('credit', 'debit')),
  fitid TEXT,
  category_id UUID REFERENCES public.financial_categories(id),
  ai_category_id UUID REFERENCES public.financial_categories(id),
  ai_confidence NUMERIC,
  classification_status TEXT NOT NULL DEFAULT 'pending' CHECK (classification_status IN ('pending', 'ai_suggested', 'confirmed', 'manual')),
  notes TEXT,
  import_batch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_bank_transactions_fitid ON public.bank_transactions(bank_account_id, fitid) WHERE fitid IS NOT NULL;
CREATE INDEX idx_bank_transactions_date ON public.bank_transactions(transaction_date);
CREATE INDEX idx_bank_transactions_account ON public.bank_transactions(bank_account_id);
CREATE INDEX idx_bank_transactions_category ON public.bank_transactions(category_id);

-- Enable RLS
ALTER TABLE public.financial_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage financial_categories" ON public.financial_categories FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage bank_transactions" ON public.bank_transactions FOR ALL USING (auth.uid() IS NOT NULL);

-- Triggers
CREATE TRIGGER update_financial_categories_updated_at BEFORE UPDATE ON public.financial_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bank_transactions_updated_at BEFORE UPDATE ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for transactions
ALTER PUBLICATION supabase_realtime ADD TABLE public.bank_transactions;
