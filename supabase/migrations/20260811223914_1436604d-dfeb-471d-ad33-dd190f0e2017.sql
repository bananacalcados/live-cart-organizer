-- Corrige custos de variações que foram gravados com o valor de VENDA no lugar do CUSTO
UPDATE public.pos_products p
SET cost_price = m.cost_price, updated_at = now()
FROM public.product_master_data m
WHERE m.parent_sku = p.parent_sku
  AND COALESCE(m.cost_price,0) > 0
  AND COALESCE(p.cost_price,0) > 0
  AND p.cost_price > m.cost_price * 1.5;

UPDATE public.product_variants v
SET cost_price_override = pm.cost_price, updated_at = now()
FROM public.products_master pm
WHERE pm.id = v.master_id
  AND COALESCE(pm.cost_price,0) > 0
  AND COALESCE(v.cost_price_override,0) > 0
  AND v.cost_price_override > pm.cost_price * 1.5;