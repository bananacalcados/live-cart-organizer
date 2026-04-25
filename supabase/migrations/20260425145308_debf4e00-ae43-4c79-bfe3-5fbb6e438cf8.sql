-- ============================================================
-- 1) SEQUÊNCIA PARA SKU ROOT
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.product_sku_root_seq START WITH 100000 INCREMENT BY 1;

-- ============================================================
-- 2) FUNÇÃO: gerar EAN-13 com prefixo 789 + dígito verificador
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_ean13_internal()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_random text;
  v_sum int := 0;
  v_digit int;
  i int;
  v_check int;
BEGIN
  -- Prefixo 789 (Brasil) + 9 dígitos aleatórios = 12 dígitos
  v_random := lpad(floor(random() * 1000000000)::text, 9, '0');
  v_base := '789' || v_random;

  -- Cálculo dígito verificador EAN-13
  FOR i IN 1..12 LOOP
    v_digit := substring(v_base from i for 1)::int;
    IF i % 2 = 0 THEN
      v_sum := v_sum + (v_digit * 3);
    ELSE
      v_sum := v_sum + v_digit;
    END IF;
  END LOOP;

  v_check := (10 - (v_sum % 10)) % 10;
  RETURN v_base || v_check::text;
END;
$$;

-- ============================================================
-- 3) FUNÇÃO: próximo SKU root sequencial
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_product_sku_root()
RETURNS text
LANGUAGE sql
SET search_path = public
AS $$
  SELECT nextval('public.product_sku_root_seq')::text;
$$;

-- ============================================================
-- 4) TABELA: products_master (cadastro pai)
-- ============================================================
CREATE TABLE public.products_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_root text NOT NULL UNIQUE DEFAULT public.next_product_sku_root(),
  name text NOT NULL,
  description text,
  brand text,
  category text,
  ncm text NOT NULL DEFAULT '64039900',
  cest text,
  origem text DEFAULT '0',
  unidade text DEFAULT 'UN',
  cost_price numeric(10,2) DEFAULT 0,
  sale_price numeric(10,2) DEFAULT 0,
  weight_kg numeric(10,3),
  height_cm numeric(10,2),
  width_cm numeric(10,2),
  length_cm numeric(10,2),
  images text[] DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  shopify_product_id text,
  tiny_product_id text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_master_sku_root ON public.products_master(sku_root);
CREATE INDEX idx_products_master_brand ON public.products_master(brand);
CREATE INDEX idx_products_master_category ON public.products_master(category);
CREATE INDEX idx_products_master_active ON public.products_master(is_active);

-- ============================================================
-- 5) TABELA: product_variants (filhos)
-- ============================================================
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id uuid NOT NULL REFERENCES public.products_master(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  gtin text NOT NULL UNIQUE DEFAULT public.generate_ean13_internal(),
  color text,
  size text,
  cost_price_override numeric(10,2),
  sale_price_override numeric(10,2),
  weight_kg_override numeric(10,3),
  initial_stock int DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  shopify_variant_id text,
  tiny_variant_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_id, color, size)
);

CREATE INDEX idx_product_variants_master ON public.product_variants(master_id);
CREATE INDEX idx_product_variants_sku ON public.product_variants(sku);
CREATE INDEX idx_product_variants_gtin ON public.product_variants(gtin);

-- ============================================================
-- 6) TABELA: product_stock_movements (histórico)
-- ============================================================
CREATE TABLE public.product_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('entry_invoice','sale','adjustment_in','adjustment_out','transfer_in','transfer_out','return')),
  quantity int NOT NULL,
  unit_cost numeric(10,2),
  reference_type text,
  reference_id uuid,
  purchase_invoice_id uuid,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_variant ON public.product_stock_movements(variant_id);
CREATE INDEX idx_stock_movements_store ON public.product_stock_movements(store_id);
CREATE INDEX idx_stock_movements_invoice ON public.product_stock_movements(purchase_invoice_id);
CREATE INDEX idx_stock_movements_created ON public.product_stock_movements(created_at DESC);

-- ============================================================
-- 7) TABELA: purchase_invoices (NF-e de entrada)
-- ============================================================
CREATE TABLE public.purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nfe_key text UNIQUE,
  invoice_number text,
  invoice_series text,
  supplier_name text,
  supplier_cnpj text,
  supplier_ie text,
  supplier_address jsonb,
  emission_date timestamptz,
  total_value numeric(12,2),
  total_products numeric(12,2),
  total_taxes numeric(12,2),
  total_freight numeric(12,2),
  total_discount numeric(12,2),
  payment_method text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','products_created','integrated','cancelled')),
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  raw_xml text,
  parsed_data jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_invoices_status ON public.purchase_invoices(status);
CREATE INDEX idx_purchase_invoices_supplier ON public.purchase_invoices(supplier_cnpj);
CREATE INDEX idx_purchase_invoices_emission ON public.purchase_invoices(emission_date DESC);

-- ============================================================
-- 8) TABELA: purchase_invoice_items
-- ============================================================
CREATE TABLE public.purchase_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  supplier_product_code text,
  description text NOT NULL,
  ncm text,
  cfop text,
  unit text DEFAULT 'UN',
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,4) NOT NULL DEFAULT 0,
  total_cost numeric(12,2) NOT NULL DEFAULT 0,
  ean text,
  -- variação parseada do XML (se houver)
  parsed_color text,
  parsed_size text,
  -- vinculação após criar produto
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  master_id uuid REFERENCES public.products_master(id) ON DELETE SET NULL,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_items_invoice ON public.purchase_invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_variant ON public.purchase_invoice_items(variant_id);

-- ============================================================
-- 9) TABELA: purchase_invoice_installments (vencimentos)
-- ============================================================
CREATE TABLE public.purchase_invoice_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  installment_number int NOT NULL DEFAULT 1,
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  paid_amount numeric(12,2),
  payment_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_installments_invoice ON public.purchase_invoice_installments(invoice_id);
CREATE INDEX idx_installments_due_date ON public.purchase_invoice_installments(due_date);
CREATE INDEX idx_installments_paid ON public.purchase_invoice_installments(paid);

-- FK adiada do stock_movements → purchase_invoices
ALTER TABLE public.product_stock_movements
  ADD CONSTRAINT fk_stock_mov_invoice
  FOREIGN KEY (purchase_invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE SET NULL;

-- ============================================================
-- 10) TRIGGERS de updated_at
-- ============================================================
CREATE TRIGGER trg_products_master_updated
  BEFORE UPDATE ON public.products_master
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_product_variants_updated
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_purchase_invoices_updated
  BEFORE UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_purchase_invoice_items_updated
  BEFORE UPDATE ON public.purchase_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_purchase_invoice_installments_updated
  BEFORE UPDATE ON public.purchase_invoice_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 11) RLS POLICIES
-- ============================================================
ALTER TABLE public.products_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_installments ENABLE ROW LEVEL SECURITY;

-- Helper: tem acesso ao módulo inventory ou é admin
-- (usa funções existentes has_role e has_module_access)

-- products_master
CREATE POLICY "inventory users can view products_master"
  ON public.products_master FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can insert products_master"
  ON public.products_master FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can update products_master"
  ON public.products_master FOR UPDATE TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can delete products_master"
  ON public.products_master FOR DELETE TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

-- product_variants
CREATE POLICY "inventory users can view product_variants"
  ON public.product_variants FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can insert product_variants"
  ON public.product_variants FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can update product_variants"
  ON public.product_variants FOR UPDATE TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can delete product_variants"
  ON public.product_variants FOR DELETE TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

-- product_stock_movements
CREATE POLICY "inventory users can view stock_movements"
  ON public.product_stock_movements FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can insert stock_movements"
  ON public.product_stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

-- purchase_invoices
CREATE POLICY "inventory users can view purchase_invoices"
  ON public.purchase_invoices FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can insert purchase_invoices"
  ON public.purchase_invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can update purchase_invoices"
  ON public.purchase_invoices FOR UPDATE TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can delete purchase_invoices"
  ON public.purchase_invoices FOR DELETE TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

-- purchase_invoice_items
CREATE POLICY "inventory users can view invoice_items"
  ON public.purchase_invoice_items FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can manage invoice_items"
  ON public.purchase_invoice_items FOR ALL TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

-- purchase_invoice_installments
CREATE POLICY "inventory users can view installments"
  ON public.purchase_invoice_installments FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "inventory users can manage installments"
  ON public.purchase_invoice_installments FOR ALL TO authenticated
  USING (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 12) STORAGE BUCKET para imagens de produtos
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can view product images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "Inventory users can upload product images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Inventory users can update product images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Inventory users can delete product images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin'))
  );

-- ============================================================
-- 13) FUNÇÃO ATÔMICA: criar produto pai + filhos
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_product_with_variants(
  p_master jsonb,
  p_variants jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_master_id uuid;
  v_variant jsonb;
  v_sku_root text;
  v_sku text;
BEGIN
  IF NOT (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Sem permissão para criar produtos';
  END IF;

  INSERT INTO public.products_master (
    name, description, brand, category, ncm, cest, origem, unidade,
    cost_price, sale_price, weight_kg, height_cm, width_cm, length_cm,
    images, is_active, created_by
  )
  VALUES (
    p_master->>'name',
    p_master->>'description',
    p_master->>'brand',
    p_master->>'category',
    COALESCE(p_master->>'ncm', '64039900'),
    p_master->>'cest',
    COALESCE(p_master->>'origem', '0'),
    COALESCE(p_master->>'unidade', 'UN'),
    COALESCE((p_master->>'cost_price')::numeric, 0),
    COALESCE((p_master->>'sale_price')::numeric, 0),
    NULLIF(p_master->>'weight_kg', '')::numeric,
    NULLIF(p_master->>'height_cm', '')::numeric,
    NULLIF(p_master->>'width_cm', '')::numeric,
    NULLIF(p_master->>'length_cm', '')::numeric,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_master->'images')), ARRAY[]::text[]),
    COALESCE((p_master->>'is_active')::boolean, true),
    auth.uid()
  )
  RETURNING id, sku_root INTO v_master_id, v_sku_root;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    v_sku := v_sku_root
      || '-' || COALESCE(NULLIF(upper(regexp_replace(v_variant->>'color', '[^A-Za-z0-9]', '', 'g')), ''), 'UN')
      || '-' || COALESCE(NULLIF(v_variant->>'size', ''), 'U');

    INSERT INTO public.product_variants (
      master_id, sku, color, size,
      cost_price_override, sale_price_override, weight_kg_override,
      initial_stock, is_active
    )
    VALUES (
      v_master_id,
      v_sku,
      v_variant->>'color',
      v_variant->>'size',
      NULLIF(v_variant->>'cost_price_override', '')::numeric,
      NULLIF(v_variant->>'sale_price_override', '')::numeric,
      NULLIF(v_variant->>'weight_kg_override', '')::numeric,
      COALESCE((v_variant->>'initial_stock')::int, 0),
      COALESCE((v_variant->>'is_active')::boolean, true)
    );
  END LOOP;

  RETURN v_master_id;
END;
$$;