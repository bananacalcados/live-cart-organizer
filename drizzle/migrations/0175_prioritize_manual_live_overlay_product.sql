CREATE OR REPLACE FUNCTION public.set_live_shown_product(p_event_id uuid, p_code text, p_shown_by text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
RETURNS live_shown_products
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare r live_shown_products;
begin
  if p_source = 'manual' then
    update live_shown_products set is_current = false where event_id = p_event_id and is_current;
    insert into live_shown_products(event_id, code, shown_by, source, is_current, stopped_at)
    values (p_event_id, p_code, p_shown_by, 'manual', true, null)
    on conflict (event_id, code) do update
      set shown_at = now(), shown_by = coalesce(excluded.shown_by, live_shown_products.shown_by),
          source = 'manual', is_current = true, stopped_at = null
    returning * into r;
  else
    insert into live_shown_products(event_id, code, shown_by, source, is_current, stopped_at)
    values (p_event_id, p_code, p_shown_by, 'comment', false, null)
    on conflict (event_id, code) do update
      set shown_at = case when live_shown_products.is_current then live_shown_products.shown_at else now() end,
          shown_by = case when live_shown_products.is_current then live_shown_products.shown_by else coalesce(excluded.shown_by, live_shown_products.shown_by) end,
          source = case when live_shown_products.is_current then live_shown_products.source else 'comment' end,
          is_current = live_shown_products.is_current,
          stopped_at = case when live_shown_products.is_current then live_shown_products.stopped_at else null end
    returning * into r;
  end if;
  insert into live_overlay_events(event_id, kind, payload)
  select p_event_id, 'product_shown',
         jsonb_build_object('code', v.code, 'product', v.product_name, 'color', v.color, 'price', v.sale_price, 'source', p_source)
  from v_product_color_codes v where v.code = p_code;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.stop_live_shown_product(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare v_code text;
begin
  update live_shown_products
     set is_current = false, stopped_at = now()
   where event_id = p_event_id and is_current
  returning code into v_code;
  if v_code is not null then
    insert into live_overlay_events(event_id, kind, payload)
    values (p_event_id, 'product_shown', jsonb_build_object('code', v_code, 'source', 'stopped'));
  end if;
end
$function$;

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
  if v_event is null then return jsonb_build_object('error', 'invalid_token'); end if;
  select coalesce(overlay_previous_minutes, 10), coalesce(overlay_show_codes, true) into v_minutes, v_show from live_code_settings where event_id = v_event;
  select live_broadcast_started_at into v_started from events where id = v_event;
  return jsonb_build_object(
    'event_id', v_event, 'show_codes', coalesce(v_show, true), 'previous_minutes', coalesce(v_minutes, 10),
    'current', (select to_jsonb(x) from (
      select s.code, v.product_name, v.color, v.sale_price,
             case when p.offer_price is not null and p.offer_price < v.sale_price then p.offer_price end as offer_price,
             coalesce(p.free_shipping, false) as free_shipping, p.interest_free_installments, s.shown_at, s.source
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
         and s.shown_at >= now() - make_interval(mins => coalesce(v_minutes, 10))
         and (v_started is null or s.shown_at >= v_started)
       order by s.shown_at desc limit 8) x), '[]'::jsonb)
  );
end $function$;