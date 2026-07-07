-- Fase 6: Atribuição de faturamento (duas camadas) em trocas/devoluções
ALTER TABLE public.trocas_devolucoes
  ADD COLUMN IF NOT EXISTS valor_devolvido numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_reposicao numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diferenca numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS faturamento_vendedora_troca numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolucao_diferenca text,
  ADD COLUMN IF NOT EXISTS estorno_forma text,
  ADD COLUMN IF NOT EXISTS voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL;

ALTER TABLE public.trocas_devolucoes
  DROP CONSTRAINT IF EXISTS trocas_devolucoes_resolucao_diferenca_check;
ALTER TABLE public.trocas_devolucoes
  ADD CONSTRAINT trocas_devolucoes_resolucao_diferenca_check
  CHECK (resolucao_diferenca IS NULL OR resolucao_diferenca IN ('cliente_paga','voucher','estorno_financeiro','sem_diferenca'));

ALTER TABLE public.trocas_devolucoes
  DROP CONSTRAINT IF EXISTS trocas_devolucoes_estorno_forma_check;
ALTER TABLE public.trocas_devolucoes
  ADD CONSTRAINT trocas_devolucoes_estorno_forma_check
  CHECK (estorno_forma IS NULL OR estorno_forma IN ('pix','cartao','dinheiro'));