CREATE TABLE public.expedition_gateway_price_rules (
  gateway text PRIMARY KEY,
  percent numeric NOT NULL CHECK (percent > 0 AND percent < 100),
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.expedition_gateway_price_rules TO authenticated;
GRANT ALL ON public.expedition_gateway_price_rules TO service_role;
ALTER TABLE public.expedition_gateway_price_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read gateway price rules" ON public.expedition_gateway_price_rules FOR SELECT TO authenticated USING (true);

ALTER TABLE public.pos_sale_price_adjustments ADD COLUMN IF NOT EXISTS auto_rule_gateway text;

-- Core: aplica (ou estende a itens novos) a regra automática de um gateway numa venda aberta da Expedição.
CREATE OR REPLACE FUNCTION public._apply_gateway_price_rule(p_sale_id uuid, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale record; v_rule record; v_adj record; v_item record; v_before jsonb; v_new numeric; v_red numeric := 0; v_ratio numeric;
BEGIN
  SELECT id, total, payment_gateway, sale_type, expedition_stage INTO v_sale FROM pos_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.sale_type NOT IN ('live','online') OR coalesce(v_sale.expedition_stage,'') IN ('concluido','cancelado') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.pos_sale_id = p_sale_id AND f.status IN ('authorized','pending') AND coalesce(f.finalidade,1) = 1) THEN RETURN false; END IF;

  SELECT * INTO v_adj FROM pos_sale_price_adjustments WHERE sale_id = p_sale_id ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    -- Já houve redução (manual ou automática, ativa ou desfeita): só estende a automática ativa a itens novos.
    IF v_adj.reverted_at IS NOT NULL OR v_adj.auto_rule_gateway IS NULL OR v_adj.mode <> 'percent' THEN RETURN false; END IF;
    v_ratio := v_adj.value / 100;
    v_before := v_adj.items_before;
    FOR v_item IN SELECT id, unit_price, total_price, quantity FROM pos_sale_items
      WHERE sale_id = p_sale_id AND unit_price > 0 AND original_unit_price IS NULL
        AND NOT (v_adj.items_before @> jsonb_build_array(jsonb_build_object('id', id))) ORDER BY id LOOP
      v_new := greatest(round(v_item.unit_price * (1 - v_ratio), 2), 0.01);
      v_before := v_before || jsonb_build_object('id', v_item.id, 'unit_price', v_item.unit_price, 'total_price', v_item.total_price);
      UPDATE pos_sale_items SET original_unit_price = unit_price, unit_price = v_new, total_price = round(v_new * quantity, 2) WHERE id = v_item.id;
      v_red := v_red + (v_item.unit_price - v_new) * v_item.quantity;
    END LOOP;
    IF v_red = 0 THEN RETURN false; END IF;
    v_red := round(v_red, 2);
    UPDATE pos_sales SET total = round(coalesce(total,0) - v_red, 2), subtotal = round(coalesce(subtotal,0) - v_red, 2) WHERE id = p_sale_id;
    UPDATE pos_sale_price_adjustments SET items_before = v_before, refund_amount = refund_amount + v_red,
      total_before = total_before + v_red, total_after = total_after WHERE id = v_adj.id;
    RETURN true;
  END IF;

  SELECT * INTO v_rule FROM expedition_gateway_price_rules WHERE gateway = v_sale.payment_gateway AND is_active;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_sale_items WHERE sale_id = p_sale_id AND unit_price > 0) THEN RETURN false; END IF;
  v_ratio := v_rule.percent / 100;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'unit_price', unit_price, 'total_price', total_price)), '[]') INTO v_before FROM pos_sale_items WHERE sale_id = p_sale_id;
  FOR v_item IN SELECT id, unit_price, quantity FROM pos_sale_items WHERE sale_id = p_sale_id AND unit_price > 0 ORDER BY id LOOP
    v_new := greatest(round(v_item.unit_price * (1 - v_ratio), 2), 0.01);
    UPDATE pos_sale_items SET original_unit_price = coalesce(original_unit_price, unit_price), unit_price = v_new, total_price = round(v_new * quantity, 2)
      WHERE id = v_item.id AND unit_price IS DISTINCT FROM v_new;
    v_red := v_red + (v_item.unit_price - v_new) * v_item.quantity;
  END LOOP;
  v_red := round(v_red, 2);
  UPDATE pos_sales SET total = round(coalesce(total,0) - v_red, 2), subtotal = round(coalesce(subtotal,0) - v_red, 2) WHERE id = p_sale_id;
  INSERT INTO pos_sale_price_adjustments(sale_id, mode, value, reason, total_before, total_after, refund_amount, items_before, created_by, auto_rule_gateway)
    VALUES (p_sale_id, 'percent', v_rule.percent, 'Regra automática do gateway ' || v_rule.gateway, coalesce(v_sale.total,0), round(coalesce(v_sale.total,0) - v_red, 2), v_red, v_before, p_actor, v_rule.gateway);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._apply_gateway_price_rule(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_gateway_price_rule_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM expedition_gateway_price_rules WHERE is_active) THEN RETURN NULL; END IF;
  FOR v_id IN SELECT DISTINCT sale_id FROM new_items WHERE sale_id IS NOT NULL AND unit_price > 0 ORDER BY 1 LOOP
    PERFORM _apply_gateway_price_rule(v_id, NULL);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_gateway_price_rule_items() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_gateway_price_rule_items AFTER INSERT ON public.pos_sale_items
  REFERENCING NEW TABLE AS new_items FOR EACH STATEMENT EXECUTE FUNCTION public.trg_gateway_price_rule_items();

CREATE OR REPLACE FUNCTION public.trg_gateway_price_rule_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM expedition_gateway_price_rules WHERE gateway = NEW.payment_gateway AND is_active) THEN
    PERFORM _apply_gateway_price_rule(NEW.id, NULL);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_gateway_price_rule_sale() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_gateway_price_rule_sale AFTER UPDATE OF payment_gateway ON public.pos_sales
  FOR EACH ROW WHEN (NEW.payment_gateway IS DISTINCT FROM OLD.payment_gateway AND NEW.payment_gateway IS NOT NULL)
  EXECUTE FUNCTION public.trg_gateway_price_rule_sale();

-- Salvar regra (admin/gerente) e aplicar às vendas abertas da Expedição.
CREATE OR REPLACE FUNCTION public.save_expedition_gateway_price_rule(p_gateway text, p_percent numeric, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager')) THEN RAISE EXCEPTION 'sem permissão'; END IF;
  IF coalesce(trim(p_gateway),'') = '' THEN RAISE EXCEPTION 'gateway obrigatório'; END IF;
  IF p_percent IS NULL OR p_percent <= 0 OR p_percent >= 100 THEN RAISE EXCEPTION 'percentual deve ser entre 0 e 100'; END IF;
  INSERT INTO expedition_gateway_price_rules(gateway, percent, is_active, updated_by, updated_at)
    VALUES (p_gateway, p_percent, p_active, auth.uid(), now())
    ON CONFLICT (gateway) DO UPDATE SET percent = EXCLUDED.percent, is_active = EXCLUDED.is_active, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_active THEN
    FOR v_id IN SELECT s.id FROM pos_sales s
      WHERE s.payment_gateway = p_gateway AND s.sale_type IN ('live','online')
        AND s.expedition_stage NOT IN ('concluido','cancelado')
        AND NOT EXISTS (SELECT 1 FROM pos_sale_price_adjustments a WHERE a.sale_id = s.id)
      ORDER BY s.id LIMIT 500 LOOP
      IF _apply_gateway_price_rule(v_id, auth.uid()) THEN v_n := v_n + 1; END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('applied', v_n);
END $$;
REVOKE ALL ON FUNCTION public.save_expedition_gateway_price_rule(text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_expedition_gateway_price_rule(text, numeric, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_expedition_gateway_price_rule(p_gateway text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager')) THEN RAISE EXCEPTION 'sem permissão'; END IF;
  DELETE FROM expedition_gateway_price_rules WHERE gateway = p_gateway;
END $$;
REVOKE ALL ON FUNCTION public.delete_expedition_gateway_price_rule(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_expedition_gateway_price_rule(text) TO authenticated;