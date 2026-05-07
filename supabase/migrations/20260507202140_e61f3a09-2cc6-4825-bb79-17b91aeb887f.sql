
-- =====================================================
-- Fase 1D — Numeração Fiscal Centralizada por CNPJ
-- =====================================================

CREATE TABLE IF NOT EXISTS public.fiscal_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  modelo SMALLINT NOT NULL CHECK (modelo IN (55, 65)),  -- 55 NF-e, 65 NFC-e
  serie SMALLINT NOT NULL DEFAULT 1 CHECK (serie >= 0 AND serie <= 999),
  last_number BIGINT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  ambiente TEXT NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao','producao')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, modelo, serie, ambiente)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_sequences_company ON public.fiscal_sequences(company_id);

ALTER TABLE public.fiscal_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage fiscal_sequences" ON public.fiscal_sequences;
CREATE POLICY "Admins manage fiscal_sequences"
  ON public.fiscal_sequences
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_fiscal_sequences_updated_at
  BEFORE UPDATE ON public.fiscal_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Atomic numbering with advisory lock
-- Returns the NEXT fiscal number for the given (company, modelo, serie, ambiente)
-- Uses pg_advisory_xact_lock to prevent concurrent emission collisions
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_next_fiscal_number(
  p_company_id UUID,
  p_modelo SMALLINT,
  p_serie SMALLINT DEFAULT 1,
  p_ambiente TEXT DEFAULT 'homologacao'
)
RETURNS TABLE(next_number BIGINT, serie SMALLINT, modelo SMALLINT, ambiente TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_next BIGINT;
BEGIN
  -- Build a deterministic lock key from (company_id hash + modelo + serie + ambiente)
  -- hashtextextended returns 64-bit hash; combine with modelo/serie to uniquely scope the lock
  v_lock_key := hashtextextended(p_company_id::text || ':' || p_modelo::text || ':' || p_serie::text || ':' || p_ambiente, 0);

  -- Acquire transaction-scoped advisory lock (auto-released at commit/rollback)
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Upsert the sequence row and atomically increment
  INSERT INTO public.fiscal_sequences (company_id, modelo, serie, ambiente, last_number)
  VALUES (p_company_id, p_modelo, p_serie, p_ambiente, 1)
  ON CONFLICT (company_id, modelo, serie, ambiente)
  DO UPDATE SET last_number = public.fiscal_sequences.last_number + 1,
                updated_at = now()
  RETURNING public.fiscal_sequences.last_number INTO v_next;

  RETURN QUERY SELECT v_next, p_serie, p_modelo, p_ambiente;
END;
$$;

-- =====================================================
-- Initialize numbering for migrated CNPJ (continue from Tiny's last number)
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_fiscal_sequence_start(
  p_company_id UUID,
  p_modelo SMALLINT,
  p_serie SMALLINT,
  p_ambiente TEXT,
  p_starting_number BIGINT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can manually set fiscal numbering';
  END IF;

  IF p_starting_number < 0 THEN
    RAISE EXCEPTION 'Starting number must be >= 0';
  END IF;

  INSERT INTO public.fiscal_sequences (company_id, modelo, serie, ambiente, last_number, notes)
  VALUES (p_company_id, p_modelo, p_serie, p_ambiente, p_starting_number, p_notes)
  ON CONFLICT (company_id, modelo, serie, ambiente)
  DO UPDATE SET last_number = EXCLUDED.last_number,
                notes = COALESCE(EXCLUDED.notes, public.fiscal_sequences.notes),
                updated_at = now();

  RETURN p_starting_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_fiscal_number(UUID, SMALLINT, SMALLINT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_fiscal_sequence_start(UUID, SMALLINT, SMALLINT, TEXT, BIGINT, TEXT) TO authenticated, service_role;
