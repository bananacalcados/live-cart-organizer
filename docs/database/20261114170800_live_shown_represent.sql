-- Repository-only record, NOT an applied or journaled migration.
-- Managed migration-file editing was blocked; do not replay during this task.
-- Owner-approved production definition from pg_get_functiondef, 2026-11-14.
CREATE OR REPLACE FUNCTION public.set_live_shown_product(p_event_id uuid, p_code text, p_shown_by text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
 RETURNS live_shown_products
 LANGUAGE plpgsql
AS $function$
declare r live_shown_products;
begin
  if p_source = 'manual' then
    update live_shown_products set is_current = false where event_id = p_event_id and is_current and code <> p_code;
    insert into live_shown_products(event_id, code, shown_by, source, is_current)
    values (p_event_id, p_code, p_shown_by, 'manual', true)
    -- reapresentar limpa a marca de "parado" (stopped_at); sem isso o produto nunca voltava ao overlay
    on conflict (event_id, code) do update set shown_at = now(), shown_by = coalesce(excluded.shown_by, live_shown_products.shown_by), source = 'manual', is_current = true, stopped_at = null
    returning * into r;
  else
    -- vindo de comentário: entra na lista de anteriores, sem mexer no atual e sem "rejuvenescer" quem já estava na lista
    insert into live_shown_products(event_id, code, shown_by, source, is_current)
    values (p_event_id, p_code, p_shown_by, p_source, false)
    on conflict (event_id, code) do nothing
    returning * into r;
    if r.id is null then select * into r from live_shown_products where event_id = p_event_id and code = p_code; end if;
  end if;
  insert into live_overlay_events(event_id, kind, payload)
  select p_event_id, 'product_shown', jsonb_build_object('code', v.code, 'product', v.product_name, 'color', v.color, 'price', v.sale_price, 'source', p_source)
  from v_product_color_codes v where v.code = p_code;
  return r;
end $function$;