CREATE OR REPLACE VIEW public.v_sale_base AS
SELECT s.id AS sale_id, ((s.created_at AT TIME ZONE 'America/Sao_Paulo'))::date AS date, s.store_id,
  CASE WHEN s.event_id IS NOT NULL OR s.source_order_id IS NOT NULL OR s.sales_channel ILIKE '%live%' THEN 'live'
       WHEN s.sales_channel = 'whatsapp' THEN 'whatsapp'
       WHEN s.sales_channel IN ('link_online','site') THEN 'online'
       WHEN s.sales_channel = 'presencial' THEN 'loja'
       ELSE 'outros' END AS channel,
  CASE WHEN st.name ILIKE '%perola%' OR st.name ILIKE '%pérola%' THEN 'perola' ELSE 'centro' END AS store_key,
  COALESCE(s.total,0) AS revenue
FROM public.pos_sales s LEFT JOIN public.pos_stores st ON st.id = s.store_id
WHERE s.status_cancelamento = 'ativo';

CREATE OR REPLACE VIEW public.v_sale_cogs AS
SELECT b.sale_id, b.date, b.store_id, b.channel, b.revenue,
  COALESCE(SUM(COALESCE(i.cost_price_at_sale, c.cost, 0) * i.quantity),0) AS cogs,
  bool_or(i.cost_price_at_sale IS NULL OR i.cost_source = 'backfill_current_cost') AS cogs_is_estimated
FROM public.v_sale_base b
LEFT JOIN public.pos_sale_items i ON i.sale_id = b.sale_id
LEFT JOIN LATERAL (SELECT r.cost FROM public.resolve_item_current_cost(i.sku, i.barcode, i.tiny_product_id) r WHERE i.cost_price_at_sale IS NULL) c ON true
GROUP BY b.sale_id, b.date, b.store_id, b.channel, b.revenue;

CREATE OR REPLACE VIEW public.v_sale_taxes AS
SELECT s.id AS sale_id,
  CASE WHEN p.tax_regime = 'simples' THEN COALESCE(s.total,0) * p.simples_rate_pct / 100
       ELSE COALESCE((SELECT SUM(i.total_price * (COALESCE(i.aliq_icms,0)+COALESCE(i.aliq_pis,0)+COALESCE(i.aliq_cofins,0)) / 100) FROM public.pos_sale_items i WHERE i.sale_id = s.id),0) END AS tax_amount
FROM public.pos_sales s CROSS JOIN public.dre_parameters p
WHERE p.id = 1 AND s.status_cancelamento = 'ativo';

CREATE OR REPLACE VIEW public.v_sale_payment_fees AS
WITH src AS (
  SELECT s.id AS sale_id, s.total, s.sales_channel, lower(COALESCE(s.payment_gateway,'')) AS gw,
         regexp_replace(COALESCE(NULLIF(s.payment_method,''), s.payment_gateway, ''), '^Dividido:\s*', '', 'i') AS pm
  FROM public.pos_sales s
  WHERE s.status_cancelamento = 'ativo' AND NOT EXISTS (SELECT 1 FROM public.payment_splits ps WHERE ps.sale_id = s.id)
), parts AS (
  SELECT src.*, p.part, count(*) OVER (PARTITION BY src.sale_id) AS nparts,
         substring(p.part from 'R\$\s?([0-9.,]+)') AS amt_txt
  FROM src, LATERAL regexp_split_to_table(src.pm, '\s\+\s') p(part)
), legs AS (
  SELECT sale_id, gw, sales_channel,
    CASE WHEN amt_txt IS NULL THEN total / nparts
         WHEN amt_txt ~ ',\d{1,2}$' THEN replace(replace(amt_txt,'.',''),',','.')::numeric
         ELSE replace(amt_txt,',','')::numeric END AS amount,
    CASE WHEN part ~* 'd[ée]bito' THEN 'debit' WHEN part ~* 'cr[ée]dito|cart[ãa]o' THEN 'credit'
         WHEN part ~* 'pix' THEN 'pix' WHEN part ~* 'boleto' THEN 'boleto' ELSE NULL END AS method,
    COALESCE(substring(part from '(\d+)\s*x')::int, 1) AS installments
  FROM parts
  UNION ALL
  SELECT ps.sale_id, lower(COALESCE(ps.gateway, s.payment_gateway, '')), s.sales_channel,
    COALESCE(ps.charge_amount, ps.amount),
    CASE WHEN ps.method ~* 'deb' THEN 'debit' WHEN ps.method ~* 'cred|card|cart' THEN 'credit' WHEN ps.method ~* 'pix' THEN 'pix' WHEN ps.method ~* 'boleto' THEN 'boleto' ELSE NULL END,
    COALESCE(ps.installments,1)
  FROM public.payment_splits ps JOIN public.pos_sales s ON s.id = ps.sale_id
  WHERE s.status_cancelamento = 'ativo' AND COALESCE(ps.status,'') NOT IN ('cancelled','refunded','failed')
), keyed AS (
  SELECT l.*,
    CASE WHEN l.gw IN ('pagarme','appmax','vindi','austpay','shopify','paypal','yampi') THEN l.gw ELSE 'mercadopago' END AS acquirer,
    CASE WHEN l.gw = '' AND l.sales_channel = 'presencial' THEN 'mp_point' ELSE 'mp_checkout' END AS product
  FROM legs l
)
SELECT k.sale_id,
  ROUND(SUM(CASE WHEN f.fee_pct IS NOT NULL THEN k.amount * f.fee_pct / 100 + f.fixed_fee ELSE 0 END), 2) AS fee_amount,
  bool_or(k.method IS NOT NULL AND f.fee_pct IS NULL) AS fee_rule_missing
FROM keyed k
LEFT JOIN LATERAL (
  SELECT x.fee_pct, x.fixed_fee FROM public.payment_method_fees x
  WHERE x.active AND x.acquirer = k.acquirer AND x.product = k.product AND x.method = k.method
    AND (x.installments = k.installments OR (k.method IN ('pix','debit','boleto') AND x.installments = 1))
  ORDER BY (x.brand IS NULL) DESC LIMIT 1
) f ON k.method IS NOT NULL
GROUP BY k.sale_id;

CREATE OR REPLACE VIEW public.v_sale_shipping AS
SELECT s.id AS sale_id, COALESCE(s.shipping_cost,0) AS shipping_charged,
  COALESCE((SELECT SUM(d.amount) FROM public.delivery_costs d WHERE d.pos_sale_id = s.id AND COALESCE(d.status,'') NOT ILIKE 'cancel%'),0) AS shipping_paid,
  ((s.shipped_at IS NOT NULL OR s.tracking_code IS NOT NULL) AND NOT COALESCE(s.is_store_pickup,false)) AS is_shipped
FROM public.pos_sales s WHERE s.status_cancelamento = 'ativo';

CREATE OR REPLACE VIEW public.v_sale_returns AS
SELECT sale_id, SUM(amount) AS returned_amount FROM (
  SELECT r.sale_id, COALESCE(r.refund_amount,0) AS amount FROM public.pos_returns r WHERE r.sale_id IS NOT NULL AND COALESCE(r.status,'') NOT ILIKE 'cancel%'
  UNION ALL
  SELECT e.original_sale_id, GREATEST(COALESCE(e.returned_total,0) - COALESCE(e.new_total,0), 0) FROM public.pos_exchanges e WHERE e.original_sale_id IS NOT NULL AND COALESCE(e.status,'') NOT ILIKE 'cancel%'
  UNION ALL
  SELECT c.pos_sale_id, COALESCE(c.amount,0) FROM public.chargebacks c WHERE c.pos_sale_id IS NOT NULL AND COALESCE(c.status,'') NOT ILIKE 'cancel%'
) u GROUP BY sale_id;

CREATE OR REPLACE VIEW public.v_sale_discounts AS
SELECT s.id AS sale_id,
  GREATEST(COALESCE(s.discount,0), COALESCE((SELECT SUM(ps.discount_amount) FROM public.payment_splits ps WHERE ps.sale_id = s.id),0)) AS discount_amount,
  COALESCE((SELECT SUM(c.cashback_amount) FROM public.internal_cashback c WHERE c.used_sale_id = s.id),0) AS cashback_redeemed
FROM public.pos_sales s WHERE s.status_cancelamento = 'ativo';

REVOKE ALL ON public.v_sale_base, public.v_sale_cogs, public.v_sale_taxes, public.v_sale_payment_fees, public.v_sale_shipping, public.v_sale_returns, public.v_sale_discounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_sale_base, public.v_sale_cogs, public.v_sale_taxes, public.v_sale_payment_fees, public.v_sale_shipping, public.v_sale_returns, public.v_sale_discounts TO service_role;

CREATE OR REPLACE FUNCTION public.dre_period(p_from date, p_to date, p_channel text DEFAULT NULL, p_store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE prm dre_parameters%ROWTYPE; v_res jsonb; v_days numeric; v_month_days numeric;
BEGIN
  IF auth.uid() IS NULL AND current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO prm FROM dre_parameters WHERE id = 1;
  v_days := (p_to - p_from + 1);
  v_month_days := EXTRACT(day FROM (date_trunc('month', p_from) + interval '1 month - 1 day'));

  WITH b AS (
    SELECT b.*, CASE WHEN b.channel = 'loja' THEN 'loja_' || b.store_key ELSE b.channel END AS ck
    FROM v_sale_base b WHERE b.date BETWEEN p_from AND p_to AND (p_store_id IS NULL OR b.store_id = p_store_id)
  ), s AS (
    SELECT b.sale_id, b.ck, b.revenue, COALESCE(c.cogs,0) cogs, COALESCE(c.cogs_is_estimated,false) est,
      COALESCE(t.tax_amount,0) tax, COALESCE(f.fee_amount,0) fee, COALESCE(f.fee_rule_missing,false) fmiss,
      COALESCE(sh.shipping_charged,0) shc, COALESCE(sh.shipping_paid,0) shp, COALESCE(sh.is_shipped,false) shipped,
      COALESCE(r.returned_amount,0) ret, COALESCE(d.discount_amount,0) disc, COALESCE(d.cashback_redeemed,0) cb
    FROM b
    LEFT JOIN v_sale_cogs c ON c.sale_id = b.sale_id
    LEFT JOIN v_sale_taxes t ON t.sale_id = b.sale_id
    LEFT JOIN v_sale_payment_fees f ON f.sale_id = b.sale_id
    LEFT JOIN v_sale_shipping sh ON sh.sale_id = b.sale_id
    LEFT JOIN v_sale_returns r ON r.sale_id = b.sale_id
    LEFT JOIN v_sale_discounts d ON d.sale_id = b.sale_id
  ), chs AS (
    SELECT unnest(ARRAY['live','whatsapp','online','loja_centro','loja_perola','outros']) ck
  ), c AS (
    SELECT chs.ck, COUNT(s.sale_id) n,
      COALESCE(SUM(s.revenue),0) rev, COALESCE(SUM(s.disc),0) disc, COALESCE(SUM(s.cb),0) cb, COALESCE(SUM(s.ret),0) ret,
      COALESCE(SUM(s.tax),0) tax, COALESCE(SUM(s.cogs),0) cogs, COALESCE(SUM(s.revenue) FILTER (WHERE s.est),0) est_rev,
      COALESCE(SUM(s.fee),0) fee, COUNT(*) FILTER (WHERE s.fmiss) fmiss,
      COALESCE(SUM(s.shc),0) shc, COALESCE(SUM(s.shp),0) shp, COUNT(*) FILTER (WHERE s.shipped) shipped
    FROM chs LEFT JOIN s ON s.ck = chs.ck GROUP BY chs.ck
  ), tot AS (SELECT NULLIF(SUM(rev - ret),0) rl_all, SUM(rev - ret) FILTER (WHERE ck NOT LIKE 'loja_%') rl_nonstore FROM c),
  ads AS (
    SELECT COALESCE(SUM(spend) FILTER (WHERE g='LIVE'),0) live, COALESCE(SUM(spend) FILTER (WHERE g='WHATSAPP'),0) wa,
           COALESCE(SUM(spend) FILTER (WHERE g NOT IN ('LIVE','WHATSAPP')),0) other
    FROM (SELECT spend, meta_ads_campaign_group(campaign_name, campaign_id) g FROM meta_ads_campaign_spend_daily WHERE date BETWEEN p_from AND p_to) x
  ), disp AS (SELECT COALESCE(SUM(cost_brl),0) v FROM v_dispatch_cost_daily WHERE date BETWEEN p_from AND p_to),
  fx AS (
    SELECT COALESCE(SUM(f.amount) FILTER (WHERE st.name ILIKE '%perola%' OR st.name ILIKE '%pérola%'),0) * v_days / v_month_days perola,
           COALESCE(SUM(f.amount) FILTER (WHERE st.name ILIKE 'loja centro%'),0) * v_days / v_month_days centro,
           COALESCE(SUM(f.amount) FILTER (WHERE NOT (st.name ILIKE '%perola%' OR st.name ILIKE '%pérola%' OR st.name ILIKE 'loja centro%')),0) * v_days / v_month_days other,
           COALESCE(SUM(f.amount),0) * v_days / v_month_days total
    FROM cost_center_store_fixed_costs f JOIN pos_stores st ON st.id = f.store_id
    WHERE f.is_active AND (p_store_id IS NULL OR f.store_id = p_store_id)
  ), m AS (
    SELECT c.*, c.rev + c.disc AS rb, c.rev - c.ret AS rl,
      COALESCE((c.rev - c.ret) / tot.rl_all, 0) share,
      (c.rev - c.ret) * CASE WHEN c.ck = 'live' THEN prm.commission_pct_live WHEN c.ck IN ('online','whatsapp') THEN prm.commission_pct_online ELSE prm.commission_pct_store END / 100 AS comm,
      CASE WHEN c.ck = 'live' THEN ads.live WHEN c.ck = 'whatsapp' THEN ads.wa ELSE 0 END + ads.other * COALESCE((c.rev - c.ret) / tot.rl_all, 0) AS mkt_ads,
      disp.v * COALESCE((c.rev - c.ret) / tot.rl_all, 0) AS mkt_disp,
      CASE WHEN prm.fixed_cost_allocation = 'by_store' THEN
        CASE WHEN c.ck = 'loja_centro' THEN fx.centro WHEN c.ck = 'loja_perola' THEN fx.perola
             ELSE fx.other * COALESCE((c.rev - c.ret) / NULLIF(tot.rl_nonstore,0), 0) END
      ELSE fx.total * COALESCE((c.rev - c.ret) / tot.rl_all, 0) END AS fixed,
      c.shipped * prm.packaging_cost_per_shipped_order AS pack
    FROM c, tot, ads, disp, fx
  ), rows AS (
    SELECT ck, n, rb, ret, disc, cb, rl, tax, cogs, est_rev, fee, fmiss, shc, shp, pack, comm, mkt_ads, mkt_disp, fixed, rev FROM m
    UNION ALL
    SELECT 'total', SUM(n), SUM(rb), SUM(ret), SUM(disc), SUM(cb), SUM(rl), SUM(tax), SUM(cogs), SUM(est_rev), SUM(fee), SUM(fmiss), SUM(shc), SUM(shp), SUM(pack), SUM(comm),
      SUM(mkt_ads) + CASE WHEN (SELECT rl_all FROM tot) IS NULL THEN (SELECT live+wa+other FROM ads) ELSE 0 END,
      SUM(mkt_disp) + CASE WHEN (SELECT rl_all FROM tot) IS NULL THEN (SELECT v FROM disp) ELSE 0 END,
      CASE WHEN prm.fixed_cost_allocation = 'by_store' AND (SELECT rl_nonstore FROM tot) IS NOT NULL AND (SELECT rl_nonstore FROM tot) > 0 THEN SUM(fixed) ELSE (SELECT total FROM fx) END,
      SUM(rev) FROM m
  ), fin AS (
    SELECT r.*, (r.rl - r.tax - r.cogs) mb,
      (r.rl - r.tax - r.cogs - r.fee - r.shp - r.pack - r.comm - r.mkt_ads - r.mkt_disp) mc
    FROM rows r
  )
  SELECT jsonb_object_agg(ck, jsonb_build_object(
    'vendas', n, 'receita_bruta', round(rb,2), 'devolucoes', round(ret,2), 'descontos_cashback', round(disc,2), 'cashback_usado', round(cb,2),
    'receita_liquida', round(rl,2), 'impostos', round(tax,2), 'cmv', round(cogs,2), 'margem_bruta', round(mb,2),
    'margem_bruta_pct', CASE WHEN rl > 0 THEN round(mb / rl * 100, 2) END,
    'taxas_pagamento', round(fee,2), 'frete_pago', round(shp,2), 'frete_cobrado', round(shc,2), 'embalagem', round(pack,2),
    'comissoes', round(comm,2), 'marketing_ads', round(mkt_ads,2), 'marketing_disparos', round(mkt_disp,2),
    'margem_contribuicao', round(mc,2), 'margem_contribuicao_pct', CASE WHEN rl > 0 THEN round(mc / rl * 100, 2) END,
    'custos_fixos', round(fixed,2), 'resultado_operacional', round(mc - fixed,2),
    'resultado_pct', CASE WHEN rl > 0 THEN round((mc - fixed) / rl * 100, 2) END,
    'ponto_equilibrio', CASE WHEN rl > 0 AND mc > 0 THEN round(fixed / (mc / rl), 2) END,
    'cmv_estimado_pct', CASE WHEN rev > 0 THEN round(est_rev / rev * 100, 2) ELSE 0 END,
    'vendas_sem_regra_taxa', fmiss))
  INTO v_res FROM fin
  WHERE p_channel IS NULL OR ck IN ('total', p_channel) OR (p_channel = 'loja' AND ck LIKE 'loja_%');

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'params', to_jsonb(prm), 'channels', v_res);
END $$;
REVOKE EXECUTE ON FUNCTION public.dre_period(date,date,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dre_period(date,date,text,uuid) TO authenticated, service_role;