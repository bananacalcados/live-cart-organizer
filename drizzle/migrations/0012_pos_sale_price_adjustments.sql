ALTER TABLE public.pos_sale_items ADD COLUMN IF NOT EXISTS original_unit_price numeric;

CREATE TABLE public.pos_sale_price_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('percent','fixed')),
  value numeric NOT NULL CHECK (value > 0),
  reason text NOT NULL,
  total_before numeric NOT NULL,
  total_after numeric NOT NULL,
  refund_amount numeric NOT NULL,
  items_before jsonb NOT NULL DEFAULT '[]'::jsonb,
  refund_done_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid
);
CREATE UNIQUE INDEX pos_sale_price_adj_one_active ON public.pos_sale_price_adjustments(sale_id) WHERE reverted_at IS NULL;
CREATE INDEX pos_sale_price_adj_sale ON public.pos_sale_price_adjustments(sale_id);

GRANT SELECT, UPDATE ON public.pos_sale_price_adjustments TO authenticated;
GRANT ALL ON public.pos_sale_price_adjustments TO service_role;
ALTER TABLE public.pos_sale_price_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read price adj" ON public.pos_sale_price_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth mark refund" ON public.pos_sale_price_adjustments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.apply_sale_price_adjustment(p_sale_ids uuid[], p_mode text, p_value numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale record; v_item record; v_ok jsonb := '[]'::jsonb; v_skip jsonb := '[]'::jsonb;
  v_gross numeric; v_ratio numeric; v_new numeric; v_red numeric; v_before jsonb;
  v_remaining numeric; v_count int; v_i int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_mode NOT IN ('percent','fixed') OR p_value IS NULL OR p_value <= 0 THEN RAISE EXCEPTION 'valor inválido'; END IF;
  IF p_mode = 'percent' AND p_value >= 100 THEN RAISE EXCEPTION 'percentual deve ser menor que 100'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'motivo obrigatório'; END IF;
  IF array_length(p_sale_ids,1) > 100 THEN RAISE EXCEPTION 'máximo de 100 pedidos por vez'; END IF;

  FOR v_sale IN SELECT id, total, subtotal FROM pos_sales WHERE id = ANY(p_sale_ids) ORDER BY id FOR UPDATE LOOP
    IF EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.pos_sale_id = v_sale.id AND f.status IN ('authorized','pending') AND coalesce(f.finalidade,1) = 1) THEN
      v_skip := v_skip || jsonb_build_object('sale_id', v_sale.id, 'motivo', 'nota fiscal já emitida'); CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM pos_sale_price_adjustments a WHERE a.sale_id = v_sale.id AND a.reverted_at IS NULL) THEN
      v_skip := v_skip || jsonb_build_object('sale_id', v_sale.id, 'motivo', 'já tem redução ativa'); CONTINUE;
    END IF;
    SELECT coalesce(sum(unit_price*quantity),0), count(*) INTO v_gross, v_count FROM pos_sale_items WHERE sale_id = v_sale.id AND unit_price > 0;
    IF v_gross <= 0 THEN v_skip := v_skip || jsonb_build_object('sale_id', v_sale.id, 'motivo', 'sem itens com valor'); CONTINUE; END IF;
    IF p_mode = 'fixed' AND p_value >= v_gross THEN
      v_skip := v_skip || jsonb_build_object('sale_id', v_sale.id, 'motivo', 'redução maior que o valor dos produtos'); CONTINUE;
    END IF;
    v_ratio := CASE WHEN p_mode = 'percent' THEN p_value/100 ELSE p_value/v_gross END;

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'unit_price', unit_price, 'total_price', total_price)), '[]') INTO v_before
      FROM pos_sale_items WHERE sale_id = v_sale.id;

    v_red := 0; v_i := 0;
    v_remaining := CASE WHEN p_mode='fixed' THEN p_value ELSE NULL END;
    FOR v_item IN SELECT id, unit_price, quantity FROM pos_sale_items WHERE sale_id = v_sale.id AND unit_price > 0 ORDER BY unit_price*quantity, id LOOP
      v_i := v_i + 1;
      IF p_mode = 'fixed' AND v_i = v_count AND v_item.quantity = 1 THEN
        v_new := round(v_item.unit_price - v_remaining, 2);  -- último item fecha os centavos
      ELSE
        v_new := round(v_item.unit_price * (1 - v_ratio), 2);
      END IF;
      IF v_new < 0.01 THEN v_new := 0.01; END IF;
      IF p_mode = 'fixed' THEN v_remaining := v_remaining - (v_item.unit_price - v_new) * v_item.quantity; END IF;
      v_red := v_red + (v_item.unit_price - v_new) * v_item.quantity;
      UPDATE pos_sale_items SET original_unit_price = coalesce(original_unit_price, unit_price),
        unit_price = v_new, total_price = round(v_new * quantity, 2)
        WHERE id = v_item.id AND unit_price IS DISTINCT FROM v_new;
    END LOOP;
    v_red := round(v_red, 2);

    UPDATE pos_sales SET total = round(coalesce(total,0) - v_red, 2), subtotal = round(coalesce(subtotal,0) - v_red, 2)
      WHERE id = v_sale.id;

    INSERT INTO pos_sale_price_adjustments(sale_id, mode, value, reason, total_before, total_after, refund_amount, items_before, created_by)
      VALUES (v_sale.id, p_mode, p_value, p_reason, coalesce(v_sale.total,0), round(coalesce(v_sale.total,0) - v_red, 2), v_red, v_before, auth.uid());
    v_ok := v_ok || jsonb_build_object('sale_id', v_sale.id, 'refund', v_red);
  END LOOP;
  RETURN jsonb_build_object('applied', v_ok, 'skipped', v_skip);
END $$;

CREATE OR REPLACE FUNCTION public.revert_sale_price_adjustment(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_adj record; v_it jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_adj FROM pos_sale_price_adjustments WHERE sale_id = p_sale_id AND reverted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido sem redução ativa'; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.pos_sale_id = p_sale_id AND f.status IN ('authorized','pending') AND coalesce(f.finalidade,1) = 1) THEN
    RAISE EXCEPTION 'nota fiscal já emitida com o valor reduzido';
  END IF;
  FOR v_it IN SELECT * FROM jsonb_array_elements(v_adj.items_before) LOOP
    UPDATE pos_sale_items SET unit_price = (v_it->>'unit_price')::numeric, total_price = (v_it->>'total_price')::numeric
      WHERE id = (v_it->>'id')::uuid AND unit_price IS DISTINCT FROM (v_it->>'unit_price')::numeric;
  END LOOP;
  UPDATE pos_sales SET total = round(coalesce(total,0) + v_adj.refund_amount, 2), subtotal = round(coalesce(subtotal,0) + v_adj.refund_amount, 2) WHERE id = p_sale_id;
  UPDATE pos_sale_price_adjustments SET reverted_at = now(), reverted_by = auth.uid() WHERE id = v_adj.id;
END $$;

REVOKE ALL ON FUNCTION public.apply_sale_price_adjustment(uuid[], text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revert_sale_price_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_sale_price_adjustment(uuid[], text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_sale_price_adjustment(uuid) TO authenticated;