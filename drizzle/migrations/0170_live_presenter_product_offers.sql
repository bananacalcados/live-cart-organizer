CREATE TABLE public.live_presenter_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  code text NOT NULL REFERENCES public.product_color_codes(code),
  offer_price numeric(12,2) CHECK (offer_price IS NULL OR offer_price > 0),
  free_shipping boolean NOT NULL DEFAULT false,
  interest_free_installments smallint CHECK (interest_free_installments IS NULL OR interest_free_installments BETWEEN 2 AND 12),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_presenter_products TO authenticated;
GRANT ALL ON public.live_presenter_products TO service_role;
ALTER TABLE public.live_presenter_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read presenter products" ON public.live_presenter_products FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "event staff insert presenter products" ON public.live_presenter_products FOR INSERT TO authenticated WITH CHECK (public.has_module_access(auth.uid(), 'events'));
CREATE POLICY "event staff update presenter products" ON public.live_presenter_products FOR UPDATE TO authenticated USING (public.has_module_access(auth.uid(), 'events')) WITH CHECK (public.has_module_access(auth.uid(), 'events'));
CREATE POLICY "event staff delete presenter products" ON public.live_presenter_products FOR DELETE TO authenticated USING (public.has_module_access(auth.uid(), 'events'));
CREATE INDEX live_presenter_products_event_created_idx ON public.live_presenter_products(event_id, created_at, code);

ALTER TABLE public.live_shown_products ADD COLUMN stopped_at timestamptz;
COMMENT ON COLUMN public.live_shown_products.stopped_at IS 'Parada manual na apresentadora: sai inclusive dos anteriores do overlay; uma nova apresentação limpa este campo.';

CREATE OR REPLACE FUNCTION public.stop_live_shown_product(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  update live_shown_products
     set is_current = false, stopped_at = now()
   where event_id = p_event_id and is_current;
end
$function$;
REVOKE ALL ON FUNCTION public.stop_live_shown_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_live_shown_product(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_live_shown_product(p_event_id uuid, p_code text, p_shown_by text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
RETURNS live_shown_products
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare r live_shown_products;
begin
  update live_shown_products set is_current = false where event_id = p_event_id and is_current;
  insert into live_shown_products(event_id, code, shown_by, source, is_current, stopped_at)
  values (p_event_id, p_code, p_shown_by, p_source, p_source = 'manual', null)
  on conflict (event_id, code) do update
    set shown_at = now(), shown_by = coalesce(excluded.shown_by, live_shown_products.shown_by),
        is_current = (excluded.source = 'manual'), stopped_at = null
  returning * into r;
  insert into live_overlay_events(event_id, kind, payload)
  select p_event_id, 'product_shown',
         jsonb_build_object('code', v.code, 'product', v.product_name, 'color', v.color, 'price', v.sale_price, 'source', p_source)
  from v_product_color_codes v where v.code = p_code;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.overlay_shown_products(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_event uuid; v_minutes int := 10; v_show boolean := true; v_started timestamptz;
begin
  if exists(select 1 from live_overlay_templates where fixed_token = p_token) then
    select id into v_event from events order by created_at desc, id desc limit 1;
  else
    select id into v_event from events where overlay_token = p_token;
  end if;
  if v_event is null then return jsonb_build_object('error','invalid_token'); end if;
  select coalesce(overlay_previous_minutes,10), coalesce(overlay_show_codes,true) into v_minutes, v_show from live_code_settings where event_id = v_event;
  select live_broadcast_started_at into v_started from events where id = v_event;
  return jsonb_build_object(
    'event_id', v_event, 'show_codes', coalesce(v_show,true), 'previous_minutes', coalesce(v_minutes,10),
    'current', (select to_jsonb(x) from (
      select s.code, v.product_name, v.color, v.sale_price,
             case when p.offer_price is not null and p.offer_price < v.sale_price then p.offer_price end as offer_price,
             coalesce(p.free_shipping,false) as free_shipping, p.interest_free_installments, s.shown_at
        from live_shown_products s
        join v_product_color_codes v on v.code = s.code
        left join live_presenter_products p on p.event_id = s.event_id and p.code = s.code
       where s.event_id = v_event and s.is_current and s.stopped_at is null and v.shopify_ok
         and (v_started is null or s.shown_at >= v_started)
       order by s.shown_at desc limit 1) x),
    'previous', coalesce((select jsonb_agg(to_jsonb(x) order by x.shown_at desc) from (
      select s.code, v.product_name, v.color, v.sale_price, s.shown_at
        from live_shown_products s
        join v_product_color_codes v on v.code = s.code
       where s.event_id = v_event and not s.is_current and s.stopped_at is null and v.shopify_ok
         and s.shown_at >= now() - make_interval(mins => coalesce(v_minutes,10))
         and (v_started is null or s.shown_at >= v_started)
       order by s.shown_at desc limit 8) x), '[]'::jsonb)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.compute_live_order_conditions(p_event_id uuid, p_username text, p_phone text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  it jsonb; out_items jsonb := '[]'::jsonb; pid text; promo event_promotions; cat event_catalog_products; xs event_crossell_offers;
  presenter live_presenter_products; presenter_base numeric; presenter_inst int; inst_base jsonb; inst_rate numeric;
  grp jsonb := '{}'::jsonb; g_key text; g_qty int; tiers jsonb; tier jsonb; unit numeric; last_tier jsonb;
  free_ship boolean := false; prod_free boolean := false; any_promo boolean := false; subtotal numeric := 0; reason text[] := '{}';
  ev events; cb record; cashback jsonb := null; open_order uuid; paid_before boolean;
begin
  select * into ev from events where id = p_event_id;
  for it in select * from jsonb_array_elements(p_items) loop
    pid := regexp_replace(coalesce(it->>'shopify_product_id', ''), '\D', '', 'g');
    promo := null; cat := null; xs := null; presenter := null; presenter_base := null;
    select * into cat from event_catalog_products where event_id = p_event_id and regexp_replace(shopify_product_id,'\D','','g') = pid and is_active limit 1;
    if cat.id is null then
      select * into xs from event_crossell_offers where event_id = p_event_id and regexp_replace(shopify_product_id,'\D','','g') = pid and is_active limit 1;
    end if;
    select p.* into presenter
      from live_presenter_products p
      join product_color_codes c on c.code = p.code
      join products_master m on m.id = c.master_id
     where p.event_id = p_event_id and regexp_replace(coalesce(m.shopify_product_id,''),'\D','','g') = pid
     limit 1;
    if presenter.id is not null then
      select coalesce(nullif(m.sale_price,0), nullif(it->>'price','')::numeric) into presenter_base
        from product_color_codes c join products_master m on m.id = c.master_id where c.code = presenter.code;
    end if;
    if presenter.interest_free_installments is not null then
      presenter_inst := least(coalesce(presenter_inst, presenter.interest_free_installments), presenter.interest_free_installments);
    end if;
    if coalesce(cat.promotion_id, xs.promotion_id) is not null then
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