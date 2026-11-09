CREATE OR REPLACE FUNCTION public.compute_live_order_conditions(p_event_id uuid, p_username text, p_phone text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  it jsonb; out_items jsonb := '[]'::jsonb; pid text; vid text; promo event_promotions; cat event_catalog_products; xs event_crossell_offers;
  presenter live_presenter_products; presenter_base numeric; presenter_inst int; inst_base jsonb; inst_rate numeric;
  grp jsonb := '{}'::jsonb; g_key text; g_qty int; tiers jsonb; tier jsonb; unit numeric; last_tier jsonb;
  free_ship boolean := false; prod_free boolean := false; any_promo boolean := false; subtotal numeric := 0; reason text[] := '{}';
  ev events; cb record; cashback jsonb := null; open_order uuid; paid_before boolean;
begin
  select * into ev from events where id = p_event_id;
  for it in select * from jsonb_array_elements(p_items) loop
    pid := regexp_replace(coalesce(it->>'shopify_product_id', ''), '\D', '', 'g');
    vid := regexp_replace(coalesce(it->>'shopify_variant_id', ''), '\D', '', 'g');
    promo := null; cat := null; xs := null; presenter := null; presenter_base := null;
    select * into cat from event_catalog_products where event_id = p_event_id and regexp_replace(shopify_product_id,'\D','','g') = pid and is_active limit 1;
    if cat.id is null then
      select * into xs from event_crossell_offers where event_id = p_event_id and regexp_replace(shopify_product_id,'\D','','g') = pid and is_active limit 1;
    end if;
    if vid <> '' then
      select p.* into presenter
        from live_presenter_products p
        join product_color_codes c on c.code = p.code
        join products_master m on m.id = c.master_id
        join product_variants pv on pv.master_id = m.id
         and lower(trim(coalesce(pv.color,''))) = lower(trim(coalesce(c.color,'')))
         and pv.is_active
         and regexp_replace(coalesce(pv.shopify_variant_id,''),'\D','','g') = vid
       where p.event_id = p_event_id
         and regexp_replace(coalesce(m.shopify_product_id,''),'\D','','g') = pid
       order by p.created_at
       limit 1;
    end if;
    if presenter.id is null then
      select p.* into presenter
        from live_presenter_products p
        join product_color_codes c on c.code = p.code
        join products_master m on m.id = c.master_id
       where p.event_id = p_event_id and regexp_replace(coalesce(m.shopify_product_id,''),'\D','','g') = pid
       order by p.created_at
       limit 1;
    end if;
    if presenter.id is not null then
      select coalesce(nullif(m.sale_price,0), nullif(it->>'price','')::numeric) into presenter_base
        from product_color_codes c join products_master m on m.id = c.master_id where c.code = presenter.code;
    end if;
    if presenter.interest_free_installments is not null then
      presenter_inst := least(coalesce(presenter_inst, presenter.interest_free_installments), presenter.interest_free_installments);
    end if;
    if presenter.promotion_id is not null then
      select * into promo from event_promotions
       where id = presenter.promotion_id and event_id = p_event_id and is_active;
    end if;
    if promo.id is null and coalesce(cat.promotion_id, xs.promotion_id) is not null then
      select * into promo from event_promotions where id = coalesce(cat.promotion_id, xs.promotion_id) and is_active;
    end if;
    if promo.id is null then
      select * into promo from event_promotions where event_id = p_event_id and is_active and pid = any(shopify_product_ids) limit 1;
    end if;
    if coalesce(presenter.free_shipping,false) or coalesce(cat.free_shipping,false) or coalesce(xs.free_shipping,false) or coalesce(promo.free_shipping,false) then prod_free := true; end if;
    if promo.id is not null then
      any_promo := true;
      g_key := promo.id::text;
      grp := jsonb_set(grp, array[g_key], to_jsonb(coalesce((grp->>g_key)::int,0) + coalesce((it->>'quantity')::int,1)));
      it := it || jsonb_build_object('promotion_id', promo.id, 'promotion_name', promo.name, 'blocks_cashback', promo.blocks_cashback);
    elsif presenter.id is not null and presenter.offer_price is not null and presenter_base is not null and presenter.offer_price < presenter_base then
      any_promo := true;
      it := it || jsonb_build_object('price', presenter.offer_price, 'discounted', true, 'promotion_name', 'Oferta da apresentação');
    elsif cat.id is not null and cat.offer_price is not null and cat.original_price is not null and cat.offer_price < cat.original_price then
      any_promo := true;
      it := it || jsonb_build_object('price', cat.offer_price, 'discounted', true);
    elsif xs.id is not null and xs.discount_price is not null and xs.original_price is not null and xs.discount_price < xs.original_price then
      any_promo := true;
      it := it || jsonb_build_object('price', xs.discount_price, 'discounted', true);
    end if;
    out_items := out_items || it;
  end loop;

  if grp <> '{}'::jsonb then
    for g_key, g_qty in select key, value::int from jsonb_each_text(grp) loop
      select * into promo from event_promotions where id = g_key::uuid;
      tiers := coalesce(promo.tiers, '[]'::jsonb);
      last_tier := null;
      for tier in select * from jsonb_array_elements(tiers) order by (value->>'qty')::int loop
        if (tier->>'qty')::int <= g_qty then last_tier := tier; end if;
      end loop;
      if last_tier is not null then
        -- Sem arredondar a unidade: a multiplicação precisa preservar exatamente o total da faixa.
        unit := (last_tier->>'price')::numeric / (last_tier->>'qty')::int;
        out_items := (select jsonb_agg(case when e->>'promotion_id' = g_key then e || jsonb_build_object('price', unit, 'discounted', true, 'tier_qty', (last_tier->>'qty')::int, 'tier_total', (last_tier->>'price')::numeric) else e end) from jsonb_array_elements(out_items) e);
      end if;
    end loop;
  end if;

  select coalesce(sum((e->>'price')::numeric * coalesce((e->>'quantity')::int,1)),0) into subtotal from jsonb_array_elements(out_items) e;

  if prod_free then free_ship := true; reason := array_append(reason, 'produto com frete grátis'); end if;
  if ev.free_shipping_threshold is not null and subtotal >= ev.free_shipping_threshold then free_ship := true; reason := array_append(reason, 'acima do mínimo da live'); end if;
  paid_before := has_paid_live_order(p_event_id, p_username, p_phone);
  if paid_before then free_ship := true; reason := array_append(reason, 'já pagou pedido nesta live'); end if;
  open_order := find_open_live_order(p_event_id, p_username, p_phone);

  if p_phone is not null and not any_promo then
    select c.id, c.coupon_code, c.cashback_amount, c.min_purchase into cb
      from internal_cashback c
     where right(regexp_replace(c.customer_phone,'\D','','g'),8) = right(regexp_replace(p_phone,'\D','','g'),8)
       and c.is_used = false and c.expires_at > now()
       and coalesce(c.min_purchase,0) <= subtotal
       and not exists (select 1 from orders o where o.cashback_id = c.id and o.stage <> 'cancelled')
     order by c.cashback_amount desc limit 1;
    if cb.id is not null then
      cashback := jsonb_build_object('id', cb.id, 'coupon_code', cb.coupon_code, 'amount', cb.cashback_amount, 'min_purchase', cb.min_purchase);
    end if;
  end if;

  if presenter_inst is not null then
    select value into inst_base from app_settings where key = 'installment_config';
    inst_rate := coalesce(nullif(inst_base->>'monthly_interest_rate','')::numeric, 2.49);
  end if;

  return jsonb_build_object(
    'items', out_items, 'subtotal', subtotal,
    'free_shipping', free_ship, 'free_shipping_reasons', to_jsonb(reason),
    'shipping_cost', case when free_ship then 0 else coalesce(ev.default_shipping_cost,0) end,
    'cashback', cashback, 'cashback_blocked', any_promo,
    'open_order_id', open_order, 'paid_before', paid_before,
    'installment_config', case when presenter_inst is null then null else jsonb_build_object(
      'max_installments', presenter_inst,
      'interest_free_installments', presenter_inst,
      'monthly_interest_rate', inst_rate,
      'source', 'live_presenter'
    ) end
  );
end $function$;