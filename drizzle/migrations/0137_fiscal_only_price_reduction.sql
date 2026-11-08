ALTER TABLE public.pos_sale_items ADD COLUMN IF NOT EXISTS fiscal_unit_price numeric;
COMMENT ON COLUMN public.pos_sale_items.fiscal_unit_price IS 'Preço usado só na NF-e/NFC-e (redução fiscal da Expedição). unit_price continua com o valor cheio vendido.';

-- Backfill: reduções ativas antigas viram só fiscais; venda volta ao valor cheio.
UPDATE public.pos_sale_items i SET fiscal_unit_price = i.unit_price,
  unit_price = (b->>'unit_price')::numeric, total_price = (b->>'total_price')::numeric
FROM public.pos_sale_price_adjustments a, jsonb_array_elements(a.items_before) b
WHERE a.reverted_at IS NULL AND (b->>'id')::uuid = i.id AND i.sale_id = a.sale_id
  AND i.unit_price IS DISTINCT FROM (b->>'unit_price')::numeric
  AND NOT EXISTS (SELECT 1 FROM public.fiscal_documents f WHERE f.pos_sale_id = a.sale_id AND f.status IN ('authorized','pending'));
UPDATE public.pos_sales s SET total = round(coalesce(s.total,0) + a.refund_amount, 2), subtotal = round(coalesce(s.subtotal,0) + a.refund_amount, 2)
FROM public.pos_sale_price_adjustments a
WHERE a.reverted_at IS NULL AND a.sale_id = s.id
  AND NOT EXISTS (SELECT 1 FROM public.fiscal_documents f WHERE f.pos_sale_id = a.sale_id AND f.status IN ('authorized','pending'));

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

  FOR v_sale IN SELECT id, total FROM pos_sales WHERE id = ANY(p_sale_ids) ORDER BY id FOR UPDATE LOOP
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
        v_new := round(v_item.unit_price - v_remaining, 2);
      ELSE
        v_new := round(v_item.unit_price * (1 - v_ratio), 2);
      END IF;
      IF v_new < 0.01 THEN v_new := 0.01; END IF;
      IF p_mode = 'fixed' THEN v_remaining := v_remaining - (v_item.unit_price - v_new) * v_item.quantity; END IF;
      v_red := v_red + (v_item.unit_price - v_new) * v_item.quantity;
      UPDATE pos_sale_items SET fiscal_unit_price = v_new WHERE id = v_item.id AND fiscal_unit_price IS DISTINCT FROM v_new;
    END LOOP;
    v_red := round(v_red, 2);
    INSERT INTO pos_sale_price_adjustments(sale_id, mode, value, reason, total_before, total_after, refund_amount, items_before, created_by)
      VALUES (v_sale.id, p_mode, p_value, p_reason, coalesce(v_sale.total,0), round(coalesce(v_sale.total,0) - v_red, 2), v_red, v_before, auth.uid());
    v_ok := v_ok || jsonb_build_object('sale_id', v_sale.id, 'refund', v_red);
  END LOOP;
  RETURN jsonb_build_object('applied', v_ok, 'skipped', v_skip);
END $$;

CREATE OR REPLACE FUNCTION public.revert_sale_price_adjustment(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_adj record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_adj FROM pos_sale_price_adjustments WHERE sale_id = p_sale_id AND reverted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido sem redução ativa'; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.pos_sale_id = p_sale_id AND f.status IN ('authorized','pending') AND coalesce(f.finalidade,1) = 1) THEN
    RAISE EXCEPTION 'nota fiscal já emitida com o valor reduzido';
  END IF;
  UPDATE pos_sale_items SET fiscal_unit_price = NULL WHERE sale_id = p_sale_id AND fiscal_unit_price IS NOT NULL;
  UPDATE pos_sale_price_adjustments SET reverted_at = now(), reverted_by = auth.uid() WHERE id = v_adj.id;
END $$;

CREATE OR REPLACE FUNCTION public._apply_gateway_price_rule(p_sale_id uuid, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale record; v_rule record; v_adj record; v_item record; v_before jsonb; v_new numeric; v_red numeric := 0; v_ratio numeric;
BEGIN
  SELECT id, total, payment_gateway, sale_type, expedition_stage INTO v_sale FROM pos_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.sale_type NOT IN ('live','online') OR coalesce(v_sale.expedition_stage,'') IN ('concluido','cancelado') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.pos_sale_id = p_sale_id AND f.status IN ('authorized','pending') AND coalesce(f.finalidade,1) = 1) THEN RETURN false; END IF;

  SELECT * INTO v_adj FROM pos_sale_price_adjustments WHERE sale_id = p_sale_id ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_adj.reverted_at IS NOT NULL OR v_adj.auto_rule_gateway IS NULL OR v_adj.mode <> 'percent' THEN RETURN false; END IF;
    v_ratio := v_adj.value / 100; v_before := v_adj.items_before;
    FOR v_item IN SELECT id, unit_price, total_price, quantity FROM pos_sale_items
      WHERE sale_id = p_sale_id AND unit_price > 0 AND fiscal_unit_price IS NULL ORDER BY id LOOP
      v_new := greatest(round(v_item.unit_price * (1 - v_ratio), 2), 0.01);
      v_before := v_before || jsonb_build_object('id', v_item.id, 'unit_price', v_item.unit_price, 'total_price', v_item.total_price);
      UPDATE pos_sale_items SET fiscal_unit_price = v_new WHERE id = v_item.id;
      v_red := v_red + (v_item.unit_price - v_new) * v_item.quantity;
    END LOOP;
    IF v_red = 0 THEN RETURN false; END IF;
    UPDATE pos_sale_price_adjustments SET items_before = v_before, refund_amount = refund_amount + round(v_red,2),
      total_before = coalesce(v_sale.total,0), total_after = round(coalesce(v_sale.total,0) - refund_amount - round(v_red,2), 2) WHERE id = v_adj.id;
    RETURN true;
  END IF;

  SELECT * INTO v_rule FROM expedition_gateway_price_rules WHERE gateway = v_sale.payment_gateway AND is_active;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_sale_items WHERE sale_id = p_sale_id AND unit_price > 0) THEN RETURN false; END IF;
  v_ratio := v_rule.percent / 100;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'unit_price', unit_price, 'total_price', total_price)), '[]') INTO v_before FROM pos_sale_items WHERE sale_id = p_sale_id;
  FOR v_item IN SELECT id, unit_price, quantity FROM pos_sale_items WHERE sale_id = p_sale_id AND unit_price > 0 ORDER BY id LOOP
    v_new := greatest(round(v_item.unit_price * (1 - v_ratio), 2), 0.01);
    UPDATE pos_sale_items SET fiscal_unit_price = v_new WHERE id = v_item.id AND fiscal_unit_price IS DISTINCT FROM v_new;
    v_red := v_red + (v_item.unit_price - v_new) * v_item.quantity;
  END LOOP;
  v_red := round(v_red, 2);
  INSERT INTO pos_sale_price_adjustments(sale_id, mode, value, reason, total_before, total_after, refund_amount, items_before, created_by, auto_rule_gateway)
    VALUES (p_sale_id, 'percent', v_rule.percent, 'Regra automática do gateway ' || v_rule.gateway, coalesce(v_sale.total,0), round(coalesce(v_sale.total,0) - v_red, 2), v_red, v_before, p_actor, v_rule.gateway);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._apply_gateway_price_rule(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Imposto do DRE incide sobre o valor da nota.
CREATE OR REPLACE VIEW public.v_sale_taxes AS
 SELECT s.id AS sale_id,
   CASE
     WHEN p.tax_regime = 'simples'::text THEN (COALESCE(s.total, 0::numeric)
        - COALESCE((SELECT a.refund_amount FROM pos_sale_price_adjustments a WHERE a.sale_id = s.id AND a.reverted_at IS NULL LIMIT 1), 0)) * p.simples_rate_pct / 100::numeric
     ELSE COALESCE((SELECT sum(COALESCE(i.fiscal_unit_price * i.quantity, i.total_price) * (COALESCE(i.aliq_icms, 0::numeric) + COALESCE(i.aliq_pis, 0::numeric) + COALESCE(i.aliq_cofins, 0::numeric)) / 100::numeric)
            FROM pos_sale_items i WHERE i.sale_id = s.id), 0::numeric)
   END AS tax_amount
 FROM pos_sales s CROSS JOIN dre_parameters p
 WHERE p.id = 1 AND s.status_cancelamento = 'ativo'::pedido_status_cancelamento;