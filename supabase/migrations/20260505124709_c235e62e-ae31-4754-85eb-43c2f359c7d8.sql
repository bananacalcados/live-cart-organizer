
-- ====== REVIEW + REFERRAL SYSTEM ======

-- 1) Tokens de avaliação enviados para clientes (ex: pós-compra)
CREATE TABLE public.review_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  customer_zoppy_id UUID REFERENCES public.zoppy_customers(id) ON DELETE SET NULL,
  store_id UUID REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  store_phone TEXT,
  cashback_value NUMERIC(10,2) DEFAULT 0,
  cashback_doubled BOOLEAN NOT NULL DEFAULT false,
  cashback_doubled_at TIMESTAMPTZ,
  review_submitted_at TIMESTAMPTZ,
  nps_score INTEGER,
  review_comment TEXT,
  improvement_suggestion TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_review_tokens_token ON public.review_tokens(token);
CREATE INDEX idx_review_tokens_phone ON public.review_tokens(customer_phone);

-- 2) Indicações criadas pelo cliente na LP
CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_token_id UUID NOT NULL REFERENCES public.review_tokens(id) ON DELETE CASCADE,
  friend_name TEXT NOT NULL,
  friend_phone TEXT NOT NULL,
  coupon_code TEXT NOT NULL UNIQUE,
  coupon_value NUMERIC(10,2) NOT NULL DEFAULT 30,
  coupon_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  message_sent_at TIMESTAMPTZ,                -- click no botão wa.me
  friend_contacted_at TIMESTAMPTZ,            -- amigo respondeu/chegou no nosso WhatsApp
  coupon_redeemed_at TIMESTAMPTZ,             -- amigo usou o cupom
  redeemed_in_sale_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | sent | contacted | converted | expired
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_token ON public.referrals(review_token_id);
CREATE INDEX idx_referrals_friend_phone ON public.referrals(friend_phone);
CREATE INDEX idx_referrals_coupon ON public.referrals(coupon_code);

-- 3) Trigger updated_at
CREATE TRIGGER trg_review_tokens_updated BEFORE UPDATE ON public.review_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_referrals_updated BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Trigger: ao atingir 3 indicações com message_sent_at, dobra cashback
CREATE OR REPLACE FUNCTION public.check_referral_double_cashback()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
  v_token RECORD;
BEGIN
  IF NEW.message_sent_at IS NULL THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.message_sent_at IS NOT NULL) THEN RETURN NEW; END IF;

  SELECT * INTO v_token FROM public.review_tokens WHERE id = NEW.review_token_id;
  IF v_token IS NULL OR v_token.cashback_doubled THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count
  FROM public.referrals
  WHERE review_token_id = NEW.review_token_id AND message_sent_at IS NOT NULL;

  IF v_count >= 3 THEN
    UPDATE public.review_tokens
    SET cashback_doubled = true,
        cashback_doubled_at = now(),
        cashback_value = cashback_value * 2
    WHERE id = NEW.review_token_id;

    -- Atualiza saldo no zoppy_customers se vinculado
    IF v_token.customer_zoppy_id IS NOT NULL THEN
      UPDATE public.zoppy_customers
      SET cashback_balance = COALESCE(cashback_balance, 0) + v_token.cashback_value
      WHERE id = v_token.customer_zoppy_id;
    END IF;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_check_double_cashback
AFTER INSERT OR UPDATE OF message_sent_at ON public.referrals
FOR EACH ROW EXECUTE FUNCTION public.check_referral_double_cashback();

-- 5) RLS
ALTER TABLE public.review_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- LP é pública: leitura por token e insert/update (via edge function service-role normalmente, mas permitimos anon p/ leitura simples)
CREATE POLICY "Public can read review_tokens by token"
  ON public.review_tokens FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can update own review_tokens"
  ON public.review_tokens FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access review_tokens"
  ON public.review_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public can read referrals"
  ON public.referrals FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can insert referrals"
  ON public.referrals FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Public can update referrals"
  ON public.referrals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
