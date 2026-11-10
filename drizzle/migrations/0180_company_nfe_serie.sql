ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS nfe_serie smallint NOT NULL DEFAULT 1;
ALTER TABLE public.companies ADD CONSTRAINT companies_nfe_serie_check CHECK (nfe_serie BETWEEN 1 AND 889);
COMMENT ON COLUMN public.companies.nfe_serie IS 'Série das NF-e modelo 55 (venda e devolução) emitidas pelo sistema; usar série própria quando outro emissor já ocupou a série 1.';