CREATE OR REPLACE FUNCTION public.process_live_comment_codes(p_comment_id text, p_event_id uuid, p_username text, p_text text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s live_code_settings; p jsonb; codes text[]; sizes text[]; last4 text;
  it live_order_intents; items jsonb; new_items jsonb := '[]'::jsonb;
  c text; i int; sz text; cc product_color_codes; v product_variants; stk int;
  item jsonb; warns text[] := '{}'; cust customers; ph text; uname text;
  n_codes int; n_sizes int; v_outcome text; all_sized boolean; existing_item jsonb; idx int; v_found boolean; v_open_order uuid; last4_prev text;
begin
  if p_event_id is null or p_username is null then return 'skip'; end if;
  select * into s from live_code_settings where event_id = p_event_id;
  if s.event_id is null or s.mode <> 'active' then return 'off'; end if;
  uname := lower(ltrim(trim(p_username),'@'));
  if uname = any(select lower(ltrim(u,'@')) from unnest(s.store_usernames) u) then return 'store'; end if;
  insert into live_code_parse_log(comment_id, event_id, username, comment_text) values (p_comment_id, p_event_id, uname, p_text)
  on conflict (comment_id) do nothing;
  if not found then return 'dup'; end if;

  p := parse_live_comment_codes(p_text);
  codes := array(select jsonb_array_elements_text(p->'codes'));
  sizes := array(select jsonb_array_elements_text(p->'sizes'));
  last4 := p->>'last4';
  if last4 is not null and not coalesce((p->>'last4_prefixed')::boolean, false)
     and exists (select 1 from model_number_tokens where token = last4) then
    last4 := null;
  end if;
  n_codes := coalesce(array_length(codes,1),0); n_sizes := coalesce(array_length(sizes,1),0);

  if n_codes = 0 and last4 is null and n_sizes = 0 then
    update live_code_parse_log l set parsed = p, outcome = 'ignored' where l.comment_id = p_comment_id; return 'ignored';
  end if;

  select * into it from live_order_intents where event_id = p_event_id and username = uname and status in ('incomplete','ready')
   order by updated_at desc limit 1;
  if n_codes = 0 and it.id is null then
    update live_code_parse_log l set parsed = p, outcome = 'no_intent' where l.comment_id = p_comment_id; return 'no_intent';
  end if;
  if it.id is null then
    select phone, phone_last4 into ph, last4_prev from live_order_intents
     where event_id = p_event_id and username = uname order by updated_at desc limit 1;
  end if;
  v_open_order := find_open_live_order(p_event_id, uname, coalesce(it.phone, ph));

  items := coalesce(it.items, '[]'::jsonb);

  for i in 1..n_codes loop
    c := codes[i];
    sz := case when n_sizes = n_codes then sizes[i] when n_sizes >= 1 then sizes[1] else null end;
    select * into cc from product_color_codes where code = c;
    if cc.code is null then
      warns := array_append(warns, 'código '||c||' não existe');
      continue;
    end if;
    v_found := false; idx := 0;
    for existing_item in select * from jsonb_array_elements(items) loop
      if existing_item->>'code' = c and coalesce(existing_item->>'status','') <> 'confirmed' then
        v_found := true;
        if sz is not null and existing_item->>'size' is null then
          items := jsonb_set(items, array[idx::text,'size'], to_jsonb(sz));
        end if;
      end if;
      idx := idx + 1;
    end loop;
    if v_found then continue; end if;
    if sz is null then
      select min(v2.size) into sz from product_variants v2
       where v2.master_id = cc.master_id and lower(trim(coalesce(v2.color,''))) = cc.color_key and v2.is_active
      having count(*) = 1;
    end if;
    item := jsonb_build_object('code', c, 'master_id', cc.master_id, 'color', cc.color, 'size', sz, 'status', 'open', 'auto_size', (sz is not null and n_sizes = 0),
              'product_name', (select name from products_master where id = cc.master_id),
              'price', (select sale_price from products_master where id = cc.master_id), 'warnings', '[]'::jsonb,
              'half_size', (sz is not null and coalesce(p->'half_sizes','[]'::jsonb) ? sz));
    items := items || item;
    if cc.shopify_ok and not exists (select 1 from live_shown_products where event_id = p_event_id and code = c) then
      perform set_live_shown_product(p_event_id, c, 'sistema', 'comment');
      warns := array_append(warns, 'código '||c||' fora da lista da live');
    end if;
  end loop;

  if n_codes = 0 and n_sizes >= 1 then
    idx := 0;
    for existing_item in select * from jsonb_array_elements(items) loop
      if existing_item->>'size' is null and coalesce(existing_item->>'status','') <> 'confirmed' then
        items := jsonb_set(items, array[idx::text,'size'], to_jsonb(sizes[least(idx+1, n_sizes)]));
      end if;
      idx := idx + 1;
    end loop;
  end if;

  new_items := '[]'::jsonb;
  for existing_item in select * from jsonb_array_elements(items) loop
    item := (existing_item - 'warnings') || jsonb_build_object('warnings','[]'::jsonb);
    if coalesce((item->>'half_size')::boolean, false) then
      item := jsonb_set(item, '{warnings}', (item->'warnings') || to_jsonb(('pediu '||(item->>'size')||',5 — confirmar')::text));
    end if;
    if not coalesce((select shopify_ok from product_color_codes where code = item->>'code'), false) then
      item := jsonb_set(item, '{warnings}', (item->'warnings') || to_jsonb(('não disponível na Shopify: '||coalesce((select shopify_status from product_color_codes where code = item->>'code'),'?'))::text));
    end if;
    if item->>'size' is not null and (item->>'variant_id') is null then
      v := null;
      select v2.* into v from product_variants v2
       where v2.master_id = (item->>'master_id')::uuid
         and lower(trim(coalesce(v2.color,''))) = lower(trim(coalesce(item->>'color','')))
         and upper(trim(v2.size)) = upper(trim(item->>'size')) and v2.is_active limit 1;
      if v.id is null then
        item := jsonb_set(item, '{warnings}', (item->'warnings') || to_jsonb(('tamanho '||(item->>'size')||' não existe nessa cor')::text));
      else
        select coalesce(sum(total_stock),0) into stk from variant_stock_cache where variant_id = v.id;
        item := item || jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'shopify_variant_id', v.shopify_variant_id, 'stock', stk);
        if stk <= 0 then item := jsonb_set(item, '{warnings}', (item->'warnings') || to_jsonb('sem estoque'::text)); end if;
      end if;
    elsif item->>'size' is not null and coalesce((item->>'stock')::int,0) <= 0 then
      item := jsonb_set(item, '{warnings}', (item->'warnings') || to_jsonb('sem estoque'::text));
    end if;
    if item->>'variant_id' is not null then
      item := item || jsonb_build_object('shopify_variant_id', (select shopify_variant_id from product_variants where id = (item->>'variant_id')::uuid));
      if not exists (select 1 from shopify_variant_mirror sm where sm.shopify_variant_id = item->>'shopify_variant_id') then
        item := jsonb_set(item, '{warnings}', (item->'warnings') || to_jsonb(('tamanho '||(item->>'size')||' não está na Shopify')::text));
      end if;
    end if;
    new_items := new_items || item;
  end loop;

  ph := coalesce(it.phone, ph);
  if last4 is not null then
    select * into cust from customers where lower(ltrim(instagram_handle,'@')) = uname limit 1;
    if cust.id is not null and right(regexp_replace(coalesce(cust.whatsapp,''),'\D','','g'),4) = last4 then
      ph := cust.whatsapp;
    elsif cust.id is not null and nullif(trim(cust.whatsapp),'') is not null then
      warns := array_append(warns, 'final '||last4||' difere do cadastro ('||right(regexp_replace(cust.whatsapp,'\D','','g'),4)||')');
    end if;
  end if;

  all_sized := not exists (select 1 from jsonb_array_elements(new_items) e where e->>'size' is null and coalesce(e->>'status','') <> 'confirmed');
  if it.id is null then
    insert into live_order_intents(event_id, username, items, phone_last4, phone, status, warnings, source_comment_ids, last_comment_text, kind, target_order_id)
    values (p_event_id, uname, new_items, coalesce(last4, last4_prev), ph, case when all_sized then 'ready' else 'incomplete' end,
            case when v_open_order is not null then array_append(warns, 'adicionar ao carrinho aberto') else warns end,
            array[p_comment_id], p_text, case when v_open_order is not null then 'add' else 'new' end, v_open_order)
    returning * into it;
    v_outcome := 'created';
  else
    update live_order_intents o set items = new_items,
      phone_last4 = coalesce(last4, o.phone_last4), phone = coalesce(ph, o.phone),
      status = case when all_sized then 'ready' else 'incomplete' end,
      kind = case when v_open_order is not null then 'add' else 'new' end, target_order_id = v_open_order,
      warnings = (select array(select distinct x from unnest(o.warnings || warns) x where x not like '%não disponível na Shopify%')),
      source_comment_ids = o.source_comment_ids || p_comment_id, last_comment_text = p_text, updated_at = now()
    where o.id = it.id returning * into it;
    v_outcome := 'updated';
  end if;
  update live_code_parse_log l set parsed = p, outcome = v_outcome, intent_id = it.id where l.comment_id = p_comment_id;
  return v_outcome;
end $function$;
