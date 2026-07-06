
-- ========== ENUMS ==========
CREATE TYPE public.td_tipo AS ENUM ('troca', 'devolucao');
CREATE TYPE public.td_motivo AS ENUM ('defeito_avaria', 'tamanho', 'arrependimento', 'erro_expedicao', 'outro');
CREATE TYPE public.td_status AS ENUM ('iniciada', 'aguardando_retorno', 'recebido_conferencia', 'concluida', 'cancelada');
CREATE TYPE public.td_modo_expedicao AS ENUM ('aguarda_retorno', 'despacho_antecipado');
CREATE TYPE public.td_origem_canal AS ENUM ('fisica', 'site');
CREATE TYPE public.td_item_direcao AS ENUM ('devolvido', 'reposicao');
CREATE TYPE public.td_estado_estoque AS ENUM ('reservado', 'despachado', 'retornado_vendavel', 'retornado_avaria');
CREATE TYPE public.voucher_status AS ENUM ('ativo', 'usado', 'expirado');
CREATE TYPE public.pedido_status_cancelamento AS ENUM ('ativo', 'cancelado');
CREATE TYPE public.pedido_motivo_cancelamento AS ENUM ('troca', 'devolucao');

-- ========== updated_at helper ==========
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ========== codigo_devolucao generator (TD-2026-000123) ==========
CREATE SEQUENCE IF NOT EXISTS public.trocas_devolucoes_codigo_seq START 1;

CREATE OR REPLACE FUNCTION public.set_codigo_devolucao()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo_devolucao IS NULL OR NEW.codigo_devolucao = '' THEN
    NEW.codigo_devolucao :=
      'TD-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.trocas_devolucoes_codigo_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ========== voucher codigo generator ==========
CREATE OR REPLACE FUNCTION public.set_voucher_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := 'VC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ========== TABLE: trocas_devolucoes ==========
CREATE TABLE public.trocas_devolucoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo_devolucao text UNIQUE,
  tipo public.td_tipo NOT NULL,
  loja_origem_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  pedido_original_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  chave_acesso_original text,
  cliente_id uuid,
  motivo public.td_motivo NOT NULL,
  status public.td_status NOT NULL DEFAULT 'iniciada',
  codigo_postagem_reversa text,
  modo_expedicao public.td_modo_expedicao NOT NULL DEFAULT 'aguarda_retorno',
  vendedora_troca_id uuid REFERENCES public.pos_sellers(id) ON DELETE SET NULL,
  origem_canal public.td_origem_canal NOT NULL,
  pedido_novo_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  chave_devolucao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_td_pedido_original ON public.trocas_devolucoes(pedido_original_id);
CREATE INDEX idx_td_pedido_novo ON public.trocas_devolucoes(pedido_novo_id);
CREATE INDEX idx_td_cliente ON public.trocas_devolucoes(cliente_id);
CREATE INDEX idx_td_status ON public.trocas_devolucoes(status);
CREATE INDEX idx_td_loja ON public.trocas_devolucoes(loja_origem_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trocas_devolucoes TO authenticated;
GRANT ALL ON public.trocas_devolucoes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.trocas_devolucoes_codigo_seq TO authenticated, service_role;

ALTER TABLE public.trocas_devolucoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe gerencia trocas_devolucoes"
  ON public.trocas_devolucoes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_td_codigo BEFORE INSERT ON public.trocas_devolucoes
  FOR EACH ROW EXECUTE FUNCTION public.set_codigo_devolucao();
CREATE TRIGGER trg_td_updated_at BEFORE UPDATE ON public.trocas_devolucoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== TABLE: trocas_devolucoes_itens ==========
CREATE TABLE public.trocas_devolucoes_itens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  troca_devolucao_id uuid NOT NULL REFERENCES public.trocas_devolucoes(id) ON DELETE CASCADE,
  direcao public.td_item_direcao NOT NULL,
  produto_id uuid,
  variacao_id uuid,
  sku text,
  tamanho text,
  barcode text,
  produto_nome text,
  quantidade integer NOT NULL DEFAULT 1,
  valor_unitario numeric NOT NULL DEFAULT 0,
  repoe_estoque boolean NOT NULL DEFAULT true,
  estado_estoque public.td_estado_estoque,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_td_itens_troca ON public.trocas_devolucoes_itens(troca_devolucao_id);
CREATE INDEX idx_td_itens_variacao ON public.trocas_devolucoes_itens(variacao_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trocas_devolucoes_itens TO authenticated;
GRANT ALL ON public.trocas_devolucoes_itens TO service_role;

ALTER TABLE public.trocas_devolucoes_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe gerencia trocas_devolucoes_itens"
  ON public.trocas_devolucoes_itens FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_td_itens_updated_at BEFORE UPDATE ON public.trocas_devolucoes_itens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== TABLE: vouchers ==========
CREATE TABLE public.vouchers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo text UNIQUE,
  cliente_id uuid,
  valor numeric NOT NULL DEFAULT 0,
  saldo numeric NOT NULL DEFAULT 0,
  validade date,
  status public.voucher_status NOT NULL DEFAULT 'ativo',
  troca_devolucao_id uuid REFERENCES public.trocas_devolucoes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vouchers_cliente ON public.vouchers(cliente_id);
CREATE INDEX idx_vouchers_status ON public.vouchers(status);
CREATE INDEX idx_vouchers_troca ON public.vouchers(troca_devolucao_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vouchers TO authenticated;
GRANT ALL ON public.vouchers TO service_role;

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe gerencia vouchers"
  ON public.vouchers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_vouchers_codigo BEFORE INSERT ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.set_voucher_codigo();
CREATE TRIGGER trg_vouchers_updated_at BEFORE UPDATE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== pos_sales: cancelamento ==========
ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS status_cancelamento public.pedido_status_cancelamento NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS motivo_cancelamento public.pedido_motivo_cancelamento;

CREATE INDEX IF NOT EXISTS idx_pos_sales_status_cancelamento ON public.pos_sales(status_cancelamento);
