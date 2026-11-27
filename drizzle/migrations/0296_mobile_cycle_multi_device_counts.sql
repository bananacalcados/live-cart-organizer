CREATE TABLE public.stock_cycle_device_counts (
  cycle_id uuid NOT NULL, variant_id uuid NOT NULL, device_id text NOT NULL,
  user_id uuid, user_name text, qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, variant_id, device_id)
);
GRANT SELECT ON public.stock_cycle_device_counts TO authenticated;
GRANT ALL ON public.stock_cycle_device_counts TO service_role;
ALTER TABLE public.stock_cycle_device_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estoque le contagens" ON public.stock_cycle_device_counts FOR SELECT TO authenticated
  USING ((select public.has_module_access((select auth.uid()), 'inventory')));

CREATE TABLE public.stock_cycle_variant_applied (
  cycle_id uuid NOT NULL, variant_id uuid NOT NULL,
  applied_total integer NOT NULL, applied_at timestamptz NOT NULL, batch_id uuid,
  PRIMARY KEY (cycle_id, variant_id)
);
GRANT SELECT ON public.stock_cycle_variant_applied TO authenticated;
GRANT ALL ON public.stock_cycle_variant_applied TO service_role;
ALTER TABLE public.stock_cycle_variant_applied ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estoque le aplicados" ON public.stock_cycle_variant_applied FOR SELECT TO authenticated
  USING ((select public.has_module_access((select auth.uid()), 'inventory')));

CREATE TABLE public.stock_cycle_devices (
  cycle_id uuid NOT NULL, device_id text NOT NULL, user_id uuid, user_name text,
  last_sent_at timestamptz, pending_left integer NOT NULL DEFAULT 0, finished boolean NOT NULL DEFAULT false,
  PRIMARY KEY (cycle_id, device_id)
);
GRANT SELECT ON public.stock_cycle_devices TO authenticated;
GRANT ALL ON public.stock_cycle_devices TO service_role;
ALTER TABLE public.stock_cycle_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estoque le aparelhos" ON public.stock_cycle_devices FOR SELECT TO authenticated
  USING ((select public.has_module_access((select auth.uid()), 'inventory')));

-- Envia o total acumulado DO APARELHO; aplica no balanço a soma de todos os aparelhos,
-- só para variações cuja soma mudou desde o último envio confirmado.
CREATE OR REPLACE FUNCTION public.mobile_cycle_submit(p_cycle_id uuid, p_device_id text, p_items jsonb,
  p_user_name text DEFAULT NULL, p_pending_left integer DEFAULT 0, p_finished boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_uid uuid := auth.uid(); c record; r record; g record;
  v_items jsonb; v_res jsonb; v_changed int := 0; v_batches int := 0;
  v_floor timestamptz := now() - interval '11 hours 50 minutes';
  v_pp uuid; v_stock numeric; v_pending numeric; v_counted numeric;
begin
  if v_uid is null or not has_module_access(v_uid, 'inventory') then raise exception 'Sem permissão de estoque'; end if;
  if coalesce(trim(p_device_id),'') = '' then raise exception 'Aparelho sem identificação'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 200 then raise exception 'Máximo de 200 variações por envio'; end if;
  select * into c from stock_inventory_cycles where id = p_cycle_id for update;
  if c.id is null then raise exception 'Inventário não encontrado'; end if;
  if c.status <> 'open' then raise exception 'Este inventário já foi encerrado'; end if;

  insert into stock_cycle_devices(cycle_id, device_id, user_id, user_name, last_sent_at, pending_left, finished)
  values (p_cycle_id, p_device_id, v_uid, p_user_name, now(), greatest(0,coalesce(p_pending_left,0)), coalesce(p_finished,false))
  on conflict (cycle_id, device_id) do update set user_id = excluded.user_id, user_name = excluded.user_name,
    last_sent_at = now(), pending_left = excluded.pending_left, finished = excluded.finished;

  create temp table if not exists _mc_touched(variant_id uuid primary key, since timestamptz) on commit drop;
  truncate _mc_touched;
  insert into _mc_touched
    select (e->>'variant_id')::uuid, max(coalesce((e->>'since')::timestamptz, now()))
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) e group by 1;

  insert into stock_cycle_device_counts(cycle_id, variant_id, device_id, user_id, user_name, qty, updated_at)
    select p_cycle_id, (e->>'variant_id')::uuid, p_device_id, v_uid, p_user_name, greatest(0,(e->>'qty')::int), now()
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) e
  on conflict (cycle_id, variant_id, device_id) do update set qty = excluded.qty, updated_at = now(), user_name = excluded.user_name
    where stock_cycle_device_counts.qty is distinct from excluded.qty;

  -- Variações cuja SOMA mudou desde o último envio aplicado.
  create temp table if not exists _mc_apply(variant_id uuid primary key, total int, anchor timestamptz, last_total int, fresh boolean) on commit drop;
  truncate _mc_apply;
  insert into _mc_apply
    select t.variant_id, s.total,
      coalesce(a.applied_at, greatest(least(t.since, now()), v_floor)),
      a.applied_total,
      (a.applied_at is null or a.applied_at >= v_floor)
    from _mc_touched t
    cross join lateral (select coalesce(sum(qty),0)::int total from stock_cycle_device_counts d
                         where d.cycle_id = p_cycle_id and d.variant_id = t.variant_id) s
    left join stock_cycle_variant_applied a on a.cycle_id = p_cycle_id and a.variant_id = t.variant_id
    where a.applied_total is distinct from s.total;

  -- Dentro do prazo: balanço do motor com abertura = último envio confirmado (ou 1º bipe).
  for g in select anchor from _mc_apply where fresh group by anchor loop
    select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'qty', total)) into v_items from _mc_apply where fresh and anchor = g.anchor;
    v_res := apply_stock_label_batch(c.store_id, 'balance', v_items, g.anchor, null, 'selected', p_user_name,
      'Balanço por bipagem — Inventário #'||c.numero);
    update stock_label_batches set cycle_id = p_cycle_id where id = (v_res->>'batch_id')::uuid;
    insert into stock_cycle_variant_applied(cycle_id, variant_id, applied_total, applied_at, batch_id)
      select p_cycle_id, variant_id, total, now(), (v_res->>'batch_id')::uuid from _mc_apply where fresh and anchor = g.anchor
    on conflict (cycle_id, variant_id) do update set applied_total = excluded.applied_total, applied_at = excluded.applied_at, batch_id = excluded.batch_id;
    v_changed := v_changed + coalesce((v_res->>'changed')::int,0); v_batches := v_batches + 1;
  end loop;

  -- Último envio há mais de ~12h: o saldo atual (com as vendas já baixadas) recebe só a diferença contada.
  v_items := '[]'::jsonb;
  for r in select * from _mc_apply where not fresh loop
    v_pp := variant_pos_product(r.variant_id, c.store_id);
    select coalesce(stock,0) into v_stock from pos_products where id = v_pp;
    v_pending := case when v_pp is null then 0 else pending_expedition_qty(v_pp, now()) end;
    v_counted := greatest(0, coalesce(v_stock,0) + v_pending + (r.total - coalesce(r.last_total,0)));
    v_items := v_items || jsonb_build_object('variant_id', r.variant_id, 'qty', v_counted);
  end loop;
  if jsonb_array_length(v_items) > 0 then
    v_res := apply_stock_label_batch(c.store_id, 'balance', v_items, now(), null, 'selected', p_user_name,
      'Balanço por bipagem (retomado) — Inventário #'||c.numero);
    update stock_label_batches set cycle_id = p_cycle_id where id = (v_res->>'batch_id')::uuid;
    insert into stock_cycle_variant_applied(cycle_id, variant_id, applied_total, applied_at, batch_id)
      select p_cycle_id, variant_id, total, now(), (v_res->>'batch_id')::uuid from _mc_apply where not fresh
    on conflict (cycle_id, variant_id) do update set applied_total = excluded.applied_total, applied_at = excluded.applied_at, batch_id = excluded.batch_id;
    v_changed := v_changed + coalesce((v_res->>'changed')::int,0); v_batches := v_batches + 1;
  end if;

  return jsonb_build_object('applied_variants', (select count(*) from _mc_apply), 'changed', v_changed, 'batches', v_batches);
end $$;

-- Variações que serão zeradas no escopo escolhido (b = só modelos com algum tamanho contado).
CREATE OR REPLACE FUNCTION public._mobile_cycle_zero_rows(p_cycle_id uuid, p_scope text)
RETURNS TABLE(variant_id uuid, pos_product_id uuid, master_id uuid, product_name text, code text, color text, size text, stock numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  with rows as (select * from stock_cycle_rows(p_cycle_id)),
  counted_masters as (select distinct master_id from rows where status = 'contado' and master_id is not null)
  select r.variant_id, r.pos_product_id, r.master_id, r.product_name, r.code, r.color, r.size, r.stock
  from rows r
  where r.status = 'nao_impresso' and r.stock <> 0 and r.variant_id is not null
    and (p_scope = 'store' or r.master_id in (select master_id from counted_masters))
$$;
REVOKE EXECUTE ON FUNCTION public._mobile_cycle_zero_rows(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mobile_cycle_conference(p_cycle_id uuid, p_scope text DEFAULT 'touched',
  p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare v_uid uuid := auth.uid(); c record; v jsonb;
begin
  if v_uid is null or not has_module_access(v_uid, 'inventory') then raise exception 'Sem permissão de estoque'; end if;
  if p_scope not in ('touched','store') then raise exception 'Escopo inválido'; end if;
  select * into c from stock_inventory_cycles where id = p_cycle_id;
  if c.id is null then raise exception 'Inventário não encontrado'; end if;
  with z as (select z.*, p.cost_price, p.price from _mobile_cycle_zero_rows(p_cycle_id, p_scope) z left join pos_products p on p.id = z.pos_product_id),
  tot as (select coalesce(sum(qty),0) pairs, count(distinct variant_id) variants from stock_cycle_device_counts where cycle_id = p_cycle_id and qty > 0)
  select jsonb_build_object(
    'cycle', jsonb_build_object('id', c.id, 'numero', c.numero, 'status', c.status, 'store_id', c.store_id, 'started_at', c.started_at, 'closed_at', c.closed_at),
    'counted_pairs', (select pairs from tot), 'counted_variants', (select variants from tot),
    'zero_variants', (select count(*) from z), 'zero_pairs', (select coalesce(sum(greatest(stock,0)),0) from z),
    'zero_cost', (select coalesce(sum(greatest(stock,0)*coalesce(cost_price,0)),0) from z),
    'zero_sale', (select coalesce(sum(greatest(stock,0)*coalesce(price,0)),0) from z),
    'store_pairs', (select coalesce(sum(greatest(stock,0)),0) from pos_products where store_id = c.store_id),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device_id', device_id, 'user_name', user_name, 'last_sent_at', last_sent_at,
                 'pending_left', pending_left, 'finished', finished) order by last_sent_at desc), '[]') from stock_cycle_devices where cycle_id = p_cycle_id),
    'zero_list', (select coalesce(jsonb_agg(x), '[]') from (select product_name, code, color, size, stock from z
                   where p_search is null or product_name ilike '%'||p_search||'%' or code ilike p_search||'%'
                   order by product_name, color, size limit least(greatest(coalesce(p_limit,50),1),200) offset greatest(coalesce(p_offset,0),0)) x),
    'counted_list', (select coalesce(jsonb_agg(x), '[]') from (
        select d.variant_id, max(pv.color) color, max(pv.size) size, max(pm.name) product_name, sum(d.qty)::int total,
          jsonb_agg(jsonb_build_object('user_name', coalesce(d.user_name,'—'), 'qty', d.qty)) by_person
        from stock_cycle_device_counts d join product_variants pv on pv.id = d.variant_id join products_master pm on pm.id = pv.master_id
        where d.cycle_id = p_cycle_id and d.qty > 0 and (p_search is null or pm.name ilike '%'||p_search||'%')
        group by d.variant_id order by max(pm.name), max(pv.color), max(pv.size)
        limit least(greatest(coalesce(p_limit,50),1),200) offset greatest(coalesce(p_offset,0),0)) x)
  ) into v;
  return v;
end $$;

-- Zera 100 por vez no escopo; bloqueia se algum aparelho tem bipes não enviados.
CREATE OR REPLACE FUNCTION public.mobile_cycle_zero(p_cycle_id uuid, p_scope text, p_confirm text, p_confirm_pairs numeric,
  p_user_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_uid uuid := auth.uid(); v_ids uuid[]; v_pairs numeric; v_res jsonb; v_rem bigint;
begin
  if v_uid is null or not has_module_access(v_uid, 'inventory') then raise exception 'Sem permissão de estoque'; end if;
  if p_scope not in ('touched','store') then raise exception 'Escopo inválido'; end if;
  if exists (select 1 from stock_cycle_devices where cycle_id = p_cycle_id and pending_left > 0) then
    raise exception 'Ainda há aparelho com bipes não enviados. Peça para todos enviarem antes de zerar.';
  end if;
  select array_agg(variant_id), coalesce(sum(greatest(stock,0)),0) into v_ids, v_pairs from _mobile_cycle_zero_rows(p_cycle_id, p_scope);
  if v_ids is null then return jsonb_build_object('changed', 0, 'remaining', 0); end if;
  if p_confirm_pairs is null or p_confirm_pairs < 0 then raise exception 'Confirme o número de pares'; end if;
  v_res := stock_cycle_zero_unprinted(p_cycle_id, p_confirm, p_user_name, v_ids, 100);
  select count(*) into v_rem from _mobile_cycle_zero_rows(p_cycle_id, p_scope);
  return jsonb_build_object('changed', coalesce((v_res->>'changed')::int,0), 'remaining', v_rem, 'pairs_at_start', v_pairs);
end $$;

-- Desfaz todos os lotes do inventário (mais novo primeiro), até 2 dias depois do encerramento.
CREATE OR REPLACE FUNCTION public.mobile_cycle_revert(p_cycle_id uuid, p_user_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_uid uuid := auth.uid(); c record; b record; v_n int := 0; v_skip jsonb := '[]'::jsonb;
begin
  if v_uid is null or not has_module_access(v_uid, 'inventory') then raise exception 'Sem permissão de estoque'; end if;
  select * into c from stock_inventory_cycles where id = p_cycle_id for update;
  if c.id is null then raise exception 'Inventário não encontrado'; end if;
  if coalesce(c.closed_at, now()) < now() - interval '2 days' then raise exception 'Prazo de 2 dias para desfazer já passou'; end if;
  for b in select * from stock_label_batches where cycle_id = p_cycle_id and status = 'applied' order by applied_at desc, numero desc loop
    if exists (select 1 from stock_label_batch_items i join stock_label_batches o on o.id = i.batch_id
               where o.status = 'applied' and o.store_id = b.store_id and o.applied_at > b.applied_at
                 and (o.cycle_id is distinct from p_cycle_id)
                 and i.variant_id in (select variant_id from stock_label_batch_items where batch_id = b.id and delta <> 0)) then
      v_skip := v_skip || jsonb_build_object('numero', b.numero, 'reason', 'lote mais novo mexeu nas mesmas variações');
      continue;
    end if;
    perform revert_stock_label_batch(b.id, p_user_name);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('reverted_batches', v_n, 'skipped', v_skip);
end $$;

REVOKE EXECUTE ON FUNCTION public.mobile_cycle_submit(uuid, text, jsonb, text, integer, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mobile_cycle_conference(uuid, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mobile_cycle_zero(uuid, text, text, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mobile_cycle_revert(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_cycle_submit(uuid, text, jsonb, text, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mobile_cycle_conference(uuid, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mobile_cycle_zero(uuid, text, text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mobile_cycle_revert(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mobile_cycle_zero_rows(uuid, text) TO service_role;