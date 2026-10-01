CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale_id ON public.pos_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_sale_items_cost_source ON public.pos_sale_items(cost_source);
CREATE INDEX IF NOT EXISTS idx_delivery_costs_pos_sale_id ON public.delivery_costs(pos_sale_id);
CREATE INDEX IF NOT EXISTS idx_internal_cashback_used_sale_id ON public.internal_cashback(used_sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_returns_sale_id ON public.pos_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_exchanges_original_sale_id ON public.pos_exchanges(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_chargebacks_pos_sale_id ON public.chargebacks(pos_sale_id);
CREATE INDEX IF NOT EXISTS idx_payment_splits_sale_id ON public.payment_splits(sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_statuscanc_created ON public.pos_sales(status_cancelamento, created_at);

ALTER TABLE public.dre_parameters
  ADD COLUMN IF NOT EXISTS fixed_cost_store_ids uuid[] NOT NULL DEFAULT ARRAY['1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2','4ade7b44-5043-4ab1-a124-7a6ab5468e29']::uuid[],
  ADD COLUMN IF NOT EXISTS exclude_marketing_fixed_cost_names text[] NOT NULL DEFAULT ARRAY['Marketing/Publicidade','Disparo Msg Api'];

CREATE OR REPLACE VIEW public.v_sale_cogs AS
SELECT b.sale_id, b.date, b.store_id, b.channel, b.revenue,
  COALESCE(SUM(COALESCE(i.cost_price_at_sale, 0) * i.quantity),0) AS cogs,
  COALESCE(bool_or(i.cost_price_at_sale IS NULL OR i.cost_source = 'backfill_current_cost'), false) AS cogs_is_estimated
FROM public.v_sale_base b
LEFT JOIN public.pos_sale_items i ON i.sale_id = b.sale_id
GROUP BY b.sale_id, b.date, b.store_id, b.channel, b.revenue;

CREATE OR REPLACE FUNCTION public.dre_period(p_from date, p_to date, p_channel text DEFAULT NULL, p_store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE prm dre_parameters%ROWTYPE; v_res jsonb; v_days numeric; v_month_days numeric;
BEGIN
  IF auth.uid() IS NULL AND current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO prm FROM dre_parameters WHERE id = 1;
  v_days := (p_to - p_from + 1);
  v_month_days := EXTRACT(day FROM (date_trunc('month', p_from) + interval '1 month - 1 day'));

  WITH sales AS MATERIALIZED (
    SELECT s.id AS sale_id, COALESCE(s.total,0) AS revenue, COALESCE(s.discount,0) AS pdisc, s.store_id,
      COALESCE(s.shipping_cost,0) AS shc,
      ((s.shipped_at IS NOT NULL OR s.tracking_code IS NOT NULL) AND NOT COALESCE(s.is_store_pickup,false)) AS shipped,
      lower(COALESCE(s.payment_gateway,'')) AS gw, s.sales_channel,
      regexp_replace(COALESCE(NULLIF(s.payment_method,''), s.payment_gateway, ''), '^Dividido:\s*', '', 'i') AS pm,
      CASE WHEN s.event_id IS NOT NULL OR s.source_order_id IS NOT NULL OR s.sales_channel ILIKE '%live%' THEN 'live'
           WHEN s.sales_channel = 'whatsapp' THEN 'whatsapp'
           WHEN s.sales_channel IN ('link_online','site') THEN 'online'
           WHEN s.sales_channel = 'presencial' THEN CASE WHEN st.name ILIKE '%perola%' OR st.name ILIKE '%pérola%' THEN 'loja_perola' ELSE 'loja_centro' END
           ELSE 'outros' END AS ck
    FROM pos_sales s LEFT JOIN pos_stores st ON st.id = s.store_id
    WHERE s.status_cancelamento = 'ativo'
      AND s.created_at >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND s.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND (p_store_id IS NULL OR s.store_id = p_store_id)
  ), items AS (
    SELECT i.sale_id,
      SUM(COALESCE(i.cost_price_at_sale,0) * i.quantity) cogs,
      bool_or(i.cost_price_at_sale IS NULL OR i.cost_source = 'backfill_current_cost') est,
      SUM(i.total_price * (COALESCE(i.aliq_icms,0)+COALESCE(i.aliq_pis,0)+COALESCE(i.aliq_cofins,0)) / 100) tax_items
    FROM pos_sale_items i JOIN sales s ON s.sale_id = i.sale_id GROUP BY i.sale_id
  ), splits AS (
    SELECT ps.* FROM payment_splits ps JOIN sales s ON s.sale_id = ps.sale_id
  ), split_disc AS (SELECT sale_id, SUM(COALESCE(discount_amount,0)) d FROM splits GROUP BY sale_id),
  cb AS (SELECT c.used_sale_id sale_id, SUM(c.cashback_amount) v FROM internal_cashback c JOIN sales s ON s.sale_id = c.used_sale_id GROUP BY 1),
  shp AS (SELECT d.pos_sale_id sale_id, SUM(d.amount) v FROM delivery_costs d JOIN sales s ON s.sale_id = d.pos_sale_id WHERE COALESCE(d.status,'') NOT ILIKE 'cancel%' GROUP BY 1),
  ret AS (
    SELECT sale_id, SUM(amount) v FROM (
      SELECT r.sale_id, COALESCE(r.refund_amount,0) amount FROM pos_returns r JOIN sales s ON s.sale_id = r.sale_id WHERE COALESCE(r.status,'') NOT ILIKE 'cancel%'
      UNION ALL SELECT e.original_sale_id, GREATEST(COALESCE(e.returned_total,0) - COALESCE(e.new_total,0), 0) FROM pos_exchanges e JOIN sales s ON s.sale_id = e.original_sale_id WHERE COALESCE(e.status,'') NOT ILIKE 'cancel%'
      UNION ALL SELECT c.pos_sale_id, COALESCE(c.amount,0) FROM chargebacks c JOIN sales s ON s.sale_id = c.pos_sale_id WHERE COALESCE(c.status,'') NOT ILIKE 'cancel%'
    ) u GROUP BY sale_id
  ), parts AS (
    SELECT s.sale_id, s.revenue, s.gw, s.sales_channel, p.part, count(*) OVER (PARTITION BY s.sale_id) nparts,
      substring(p.part from 'R\$\s?([0-9.,]+)') amt_txt
    FROM sales s, LATERAL regexp_split_to_table(s.pm, '\s\+\s') p(part)
    WHERE NOT EXISTS (SELECT 1 FROM splits x WHERE x.sale_id = s.sale_id)
  ), legs AS (
    SELECT sale_id, gw, sales_channel,
      CASE WHEN amt_txt IS NULL THEN revenue / nparts
           WHEN amt_txt ~ ',\d{1,2}$' THEN replace(replace(amt_txt,'.',''),',','.')::numeric
           ELSE replace(amt_txt,',','')::numeric END amount,
      CASE WHEN part ~* 'd[ée]bito' THEN 'debit' WHEN part ~* 'cr[ée]dito|cart[ãa]o' THEN 'credit'
           WHEN part ~* 'pix' THEN 'pix' WHEN part ~* 'boleto' THEN 'boleto' END method,
      COALESCE(substring(part from '(\d+)\s*x')::int, 1) inst
    FROM parts
    UNION ALL
    SELECT x.sale_id, lower(COALESCE(x.gateway, s.gw, '')), s.sales_channel, COALESCE(x.charge_amount, x.amount),
      CASE WHEN x.method ~* 'deb' THEN 'debit' WHEN x.method ~* 'cred|card|cart' THEN 'credit' WHEN x.method ~* 'pix' THEN 'pix' WHEN x.method ~* 'boleto' THEN 'boleto' END,
      COALESCE(x.installments,1)
    FROM splits x JOIN sales s ON s.sale_id = x.sale_id
    WHERE COALESCE(x.status,'') NOT IN ('cancelled','refunded','failed')
  ), fees AS (
    SELECT l.sale_id,
      SUM(CASE WHEN f.fee_pct IS NOT NULL THEN l.amount * f.fee_pct / 100 + f.fixed_fee ELSE 0 END) v,
      bool_or(l.method IS NOT NULL AND f.fee_pct IS NULL) miss
    FROM legs l
    LEFT JOIN LATERAL (
      SELECT x.fee_pct, x.fixed_fee FROM payment_method_fees x
      WHERE x.active AND l.method IS NOT NULL
        AND x.acquirer = CASE WHEN l.gw IN ('pagarme','appmax','vindi','austpay','shopify','paypal','yampi') THEN l.gw ELSE 'mercadopago' END
        AND x.product = CASE WHEN l.gw = '' AND l.sales_channel = 'presencial' THEN 'mp_point' ELSE 'mp_checkout' END
        AND x.method = l.method
        AND (x.installments = l.inst OR (l.method IN ('pix','debit','boleto') AND x.installments = 1))
      ORDER BY (x.brand IS NULL) DESC LIMIT 1
    ) f ON true
    GROUP BY l.sale_id
  ), s AS (
    SELECT sa.sale_id, sa.ck, sa.revenue, COALESCE(it.cogs,0) cogs, COALESCE(it.est,true) est,
      CASE WHEN prm.tax_regime = 'simples' THEN sa.revenue * prm.simples_rate_pct / 100 ELSE COALESCE(it.tax_items,0) END tax,
      COALESCE(fe.v,0) fee, COALESCE(fe.miss,false) fmiss, sa.shc, COALESCE(sh.v,0) shp, sa.shipped,
      COALESCE(rt.v,0) ret, GREATEST(sa.pdisc, COALESCE(sd.d,0)) disc, COALESCE(cb.v,0) cb
    FROM sales sa
    LEFT JOIN items it ON it.sale_id = sa.sale_id
    LEFT JOIN fees fe ON fe.sale_id = sa.sale_id
    LEFT JOIN shp sh ON sh.sale_id = sa.sale_id
    LEFT JOIN ret rt ON rt.sale_id = sa.sale_id
    LEFT JOIN split_disc sd ON sd.sale_id = sa.sale_id
    LEFT JOIN cb ON cb.sale_id = sa.sale_id
  ), chs AS (
    SELECT unnest(ARRAY['live','whatsapp','online','loja_centro','loja_perola','outros']) ck
  ), c AS (
    SELECT chs.ck, COUNT(s.sale_id) n,
      COALESCE(SUM(s.revenue),0) rev, COALESCE(SUM(s.disc),0) disc, COALESCE(SUM(s.cb),0) cb, COALESCE(SUM(s.ret),0) ret,
      COALESCE(SUM(s.tax),0) tax, COALESCE(SUM(s.cogs),0) cogs, COALESCE(SUM(s.revenue) FILTER (WHERE s.est),0) est_rev,
      COALESCE(SUM(s.fee),0) fee, COUNT(*) FILTER (WHERE s.fmiss) fmiss,
      COALESCE(SUM(s.shc),0) shc, COALESCE(SUM(s.shp),0) shp, COUNT(*) FILTER (WHERE s.shipped) shipped
    FROM chs LEFT JOIN s ON s.ck = chs.ck GROUP BY chs.ck
  ), tot AS (SELECT NULLIF(SUM(rev - ret),0) rl_all FROM c),
  ads AS (
    SELECT COALESCE(SUM(spend) FILTER (WHERE g='LIVE'),0) live, COALESCE(SUM(spend) FILTER (WHERE g='WHATSAPP'),0) wa,
           COALESCE(SUM(spend) FILTER (WHERE g NOT IN ('LIVE','WHATSAPP')),0) other
    FROM (SELECT spend, meta_ads_campaign_group(campaign_name, campaign_id) g FROM meta_ads_campaign_spend_daily WHERE date BETWEEN p_from AND p_to) x
  ), disp AS (SELECT COALESCE(SUM(cost_brl),0) v FROM v_dispatch_cost_daily WHERE date BETWEEN p_from AND p_to),
  fx AS (
    SELECT COALESCE(SUM(f.amount) FILTER (WHERE st.name ILIKE '%perola%' OR st.name ILIKE '%pérola%'),0) * v_days / v_month_days perola,
           COALESCE(SUM(f.amount) FILTER (WHERE NOT (st.name ILIKE '%perola%' OR st.name ILIKE '%pérola%')),0) * v_days / v_month_days centro,
           COALESCE(SUM(f.amount),0) * v_days / v_month_days total
    FROM cost_center_store_fixed_costs f
    JOIN pos_stores st ON st.id = f.store_id
    LEFT JOIN cost_center_fixed_costs fc ON fc.id = f.fixed_cost_id
    WHERE f.is_active AND f.store_id = ANY(prm.fixed_cost_store_ids)
      AND (p_store_id IS NULL OR f.store_id = p_store_id)
      AND NOT (COALESCE(fc.name,'') = ANY(COALESCE(prm.exclude_marketing_fixed_cost_names, '{}')))
  ), m AS (
    SELECT c.*, c.rev + c.disc AS rb, c.rev - c.ret AS rl,
      (c.rev - c.ret) * CASE WHEN c.ck = 'live' THEN prm.commission_pct_live WHEN c.ck IN ('online','whatsapp') THEN prm.commission_pct_online ELSE prm.commission_pct_store END / 100 AS comm,
      CASE WHEN c.ck = 'live' THEN ads.live WHEN c.ck = 'whatsapp' THEN ads.wa ELSE 0 END + ads.other * COALESCE((c.rev - c.ret) / tot.rl_all, 0) AS mkt_ads,
      disp.v * COALESCE((c.rev - c.ret) / tot.rl_all, 0) AS mkt_disp,
      CASE WHEN prm.fixed_cost_allocation = 'by_store' THEN
        CASE WHEN c.ck = 'loja_centro' THEN fx.centro WHEN c.ck = 'loja_perola' THEN fx.perola ELSE 0 END
      ELSE fx.total * COALESCE((c.rev - c.ret) / tot.rl_all, 0) END AS fixed,
      c.shipped * prm.packaging_cost_per_shipped_order AS pack
    FROM c, tot, ads, disp, fx
  ), rows AS (
    SELECT ck, n, rb, ret, disc, cb, rl, tax, cogs, est_rev, fee, fmiss, shc, shp, pack, comm, mkt_ads, mkt_disp, fixed, rev FROM m
    UNION ALL
    SELECT 'total', SUM(n), SUM(rb), SUM(ret), SUM(disc), SUM(cb), SUM(rl), SUM(tax), SUM(cogs), SUM(est_rev), SUM(fee), SUM(fmiss), SUM(shc), SUM(shp), SUM(pack), SUM(comm),
      CASE WHEN (SELECT rl_all FROM tot) IS NULL THEN (SELECT live+wa+other FROM ads) ELSE SUM(mkt_ads) END,
      CASE WHEN (SELECT rl_all FROM tot) IS NULL THEN (SELECT v FROM disp) ELSE SUM(mkt_disp) END,
      (SELECT total FROM fx), SUM(rev) FROM m
  ), fin AS (
    SELECT r.*, (r.rl - r.tax - r.cogs) mb, (r.rl - r.tax - r.cogs - r.fee - r.shp - r.pack - r.comm - r.mkt_ads - r.mkt_disp) mc FROM rows r
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