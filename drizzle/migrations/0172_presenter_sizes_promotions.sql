ALTER TABLE public.live_presenter_products
  ADD COLUMN IF NOT EXISTS available_sizes text[];

ALTER TABLE public.live_presenter_products
  ADD COLUMN IF NOT EXISTS promotion_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_presenter_products_promotion_id_fkey'
      AND conrelid = 'public.live_presenter_products'::regclass
  ) THEN
    ALTER TABLE public.live_presenter_products
      ADD CONSTRAINT live_presenter_products_promotion_id_fkey
      FOREIGN KEY (promotion_id) REFERENCES public.event_promotions(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.live_presenter_products.available_sizes IS
  'Numerações liberadas pela apresentadora; NULL mantém todas as variações ativas liberadas.';
COMMENT ON COLUMN public.live_presenter_products.promotion_id IS
  'Promoção progressiva ativa da própria live escolhida para este código.';

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
        unit := round(((last_tier->>'price')::numeric / (last_tier->>'qty')::int), 2);
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

CREATE OR REPLACE FUNCTION public.refresh_open_live_intents(p_event_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r live_order_intents; n int := 0; new_items jsonb; item jsonb; e jsonb; v product_variants; stk int; cc product_color_codes;
begin
  for r in select * from live_order_intents where status in ('incomplete','ready') and (p_event_id is null or event_id = p_event_id) loop
    new_items := '[]'::jsonb;
    for e in select * from jsonb_array_elements(r.items) loop
      item := (e - 'warnings' - 'variant_id' - 'sku' - 'shopify_variant_id' - 'stock') || jsonb_build_object('warnings','[]'::jsonb);
      cc := null;
      select * into cc from product_color_codes where code = item->>'code';
      if not coalesce(cc.shopify_ok,false) then
        item := jsonb_set(item, '{warnings}', (item->'warnings') || to_jsonb(('não disponível na Shopify: '||coalesce(cc.shopify_status,'?'))::text));
      end if;
      if item->>'size' is not null then
        v := null;
        select v2.* into v from product_variants v2 where v2.master_id=(item->>'master_id')::uuid
          and lower(trim(coalesce(v2.color,'')))=lower(trim(coalesce(item->>'color',''))) and upper(trim(v2.size))=upper(trim(item->>'size')) and v2.is_active limit 1;
        if v.id is null then
          item := jsonb_set(item,'{warnings}',(item->'warnings') || to_jsonb(('tamanho '||(item->>'size')||' não existe nessa cor')::text));
        else
          select coalesce(sum(total_stock),0) into stk from variant_stock_cache where variant_id=v.id;
          item := item || jsonb_build_object('variant_id',v.id,'sku',v.sku,'shopify_variant_id',v.shopify_variant_id,'stock',stk);
          if stk<=0 then item := jsonb_set(item,'{warnings}',(item->'warnings') || to_jsonb('sem estoque'::text)); end if;
          if not exists (select 1 from shopify_variant_mirror sm where sm.shopify_variant_id=v.shopify_variant_id) then
            item := jsonb_set(item,'{warnings}',(item->'warnings') || to_jsonb(('tamanho '||(item->>'size')||' não está na Shopify')::text));
          end if;
          if exists (
            select 1 from live_presenter_products lp
             where lp.event_id = r.event_id and lp.code = item->>'code' and lp.available_sizes is not null
               and not exists (
                 select 1 from unnest(lp.available_sizes) as allowed(size)
                  where upper(trim(allowed.size)) = upper(trim(item->>'size'))
               )
          ) then
            item := jsonb_set(item,'{warnings}',(item->'warnings') || to_jsonb(('tamanho '||(item->>'size')||' não existe nessa cor nas numerações liberadas pela apresentadora')::text));
          end if;
        end if;
      end if;
      new_items := new_items || item;
    end loop;
    update live_order_intents set items = new_items,
      warnings = array(select x from unnest(warnings) x where x not like '%não disponível na Shopify%'),
      updated_at = now()
     where id = r.id
       and (
         r.items is distinct from new_items
         or r.warnings is distinct from array(select x from unnest(r.warnings) x where x not like '%não disponível na Shopify%')
       );
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.update_live_order_intent_item(p_intent_id uuid, p_index integer, p_size text)
 RETURNS live_order_intents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r live_order_intents; v product_variants; it jsonb; stk int;
begin
  if auth.uid() is not null and not public.has_module_access(auth.uid(), 'events') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select * into r from live_order_intents where id = p_intent_id;
  it := r.items -> p_index;
  if it is null then raise exception 'item não existe'; end if;
  it := it - 'variant_id' - 'sku' - 'shopify_variant_id' - 'stock' || jsonb_build_object('size', p_size, 'warnings', '[]'::jsonb);
  select v2.* into v from product_variants v2 where v2.master_id=(it->>'master_id')::uuid
    and lower(trim(coalesce(v2.color,'')))=lower(trim(coalesce(it->>'color',''))) and trim(v2.size)=trim(p_size) and v2.is_active limit 1;
  if v.id is null then
    it := jsonb_set(it,'{warnings}', to_jsonb(array['tamanho '||p_size||' não existe nessa cor']));
  else
    select coalesce(sum(total_stock),0) into stk from product_variant_stock where variant_id=v.id;
    it := it || jsonb_build_object('variant_id',v.id,'sku',v.sku,'shopify_variant_id',v.shopify_variant_id,'stock',stk);
    if stk<=0 then it := jsonb_set(it,'{warnings}', to_jsonb(array['sem estoque'])); end if;
    if exists (
      select 1 from live_presenter_products lp
       where lp.event_id = r.event_id and lp.code = it->>'code' and lp.available_sizes is not null
         and not exists (
           select 1 from unnest(lp.available_sizes) as allowed(size)
            where upper(trim(allowed.size)) = upper(trim(p_size))
         )
    ) then
      it := jsonb_set(it,'{warnings}',(it->'warnings') || to_jsonb(('tamanho '||p_size||' não existe nessa cor nas numerações liberadas pela apresentadora')::text));
    end if;
  end if;
  update live_order_intents set items = jsonb_set(items, array[p_index::text], it),
    status = case when status in ('confirmed','dismissed') then status else 'ready' end, updated_at=now()
  where id = p_intent_id returning * into r;
  return r;
end $function$;