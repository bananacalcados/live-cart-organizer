alter table public.orders
  add column if not exists voucher_id uuid,
  add column if not exists voucher_amount numeric not null default 0;

alter table public.pos_sales
  add column if not exists voucher_id uuid,
  add column if not exists voucher_amount numeric not null default 0;

alter table public.vouchers
  add column if not exists used_at timestamptz,
  add column if not exists used_order_id uuid,
  add column if not exists used_sale_id uuid;

create index if not exists orders_voucher_id_idx on public.orders(voucher_id) where voucher_id is not null;
create index if not exists pos_sales_voucher_id_idx on public.pos_sales(voucher_id) where voucher_id is not null;

create or replace function public.available_vouchers_for_target(
  p_phone text default null,
  p_order_id uuid default null,
  p_sale_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  id uuid,
  codigo text,
  saldo numeric,
  validade date,
  status public.voucher_status,
  applied_amount numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
  v_suffix text;
  v_pos_customer uuid;
  v_current uuid;
  v_applied numeric := 0;
  v_locked boolean := false;
begin
  if not (auth.role() = 'service_role' or public.is_team_member(auth.uid())) then
    raise exception 'Acesso negado';
  end if;
  if p_order_id is not null and p_sale_id is not null then
    raise exception 'Informe apenas um destino';
  end if;

  if p_order_id is not null then
    select
      coalesce(nullif(reg.whatsapp, ''), nullif(c.whatsapp, '')),
      o.voucher_id,
      coalesce(o.voucher_amount, 0),
      coalesce(o.is_paid, false) or coalesce(o.paid_externally, false) or o.stage = 'cancelled'
    into v_phone, v_current, v_applied, v_locked
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join lateral (
      select r.whatsapp from public.customer_registrations r
      where r.order_id = o.id order by r.created_at desc limit 1
    ) reg on true
    where o.id = p_order_id;
    if not found then raise exception 'Pedido não encontrado'; end if;
  elsif p_sale_id is not null then
    select
      coalesce(nullif(s.customer_phone, ''), nullif(pc.whatsapp, '')),
      s.customer_id,
      s.voucher_id,
      coalesce(s.voucher_amount, 0),
      coalesce(s.status, '') in ('paid', 'completed', 'pending_pickup', 'cancelled', 'refunded')
    into v_phone, v_pos_customer, v_current, v_applied, v_locked
    from public.pos_sales s
    left join public.pos_customers pc on pc.id = s.customer_id
    where s.id = p_sale_id;
    if not found then raise exception 'Venda não encontrada'; end if;
  else
    v_phone := p_phone;
  end if;

  v_suffix := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 8);

  return query
  select v.id, v.codigo, v.saldo, v.validade, v.status,
    case when v.id = v_current then v_applied else 0::numeric end
  from public.vouchers v
  join public.pos_customers owner on owner.id = v.cliente_id
  where (
    v.id = v_current
    or (
      not v_locked
      and v.status = 'ativo'
      and v.saldo > 0
      and (v.validade is null or v.validade >= current_date)
      and (
        (v_pos_customer is not null and v.cliente_id = v_pos_customer)
        or (
          length(v_suffix) = 8
          and right(regexp_replace(coalesce(owner.whatsapp, ''), '\D', '', 'g'), 8) = v_suffix
        )
      )
      and not exists (
        select 1 from public.orders o
        where o.voucher_id = v.id and o.stage <> 'cancelled'
      )
      and not exists (
        select 1 from public.pos_sales s
        where s.voucher_id = v.id and coalesce(s.status, '') not in ('cancelled', 'refunded')
      )
    )
  )
  order by case when v.id = v_current then 0 else 1 end, v.created_at desc
  limit least(200, greatest(1, coalesce(p_limit, 20)))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.available_vouchers_for_target(text, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.available_vouchers_for_target(text, uuid, uuid, integer, integer) to authenticated, service_role;

create or replace function public.set_target_voucher(
  p_order_id uuid default null,
  p_sale_id uuid default null,
  p_voucher_id uuid default null
)
returns table(
  voucher_id uuid,
  voucher_amount numeric,
  discount_type text,
  discount_value numeric,
  total numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_sale public.pos_sales%rowtype;
  v_voucher public.vouchers%rowtype;
  v_phone text;
  v_suffix text;
  v_voucher_suffix text;
  v_old uuid;
  v_old_amount numeric := 0;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_shipping numeric := 0;
  v_base numeric := 0;
  v_amount numeric := 0;
  v_new_discount numeric := 0;
  v_total numeric := 0;
begin
  if not (auth.role() = 'service_role' or public.is_team_member(auth.uid())) then
    raise exception 'Acesso negado';
  end if;
  if (p_order_id is null) = (p_sale_id is null) then
    raise exception 'Informe um pedido ou uma venda';
  end if;

  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then raise exception 'Pedido não encontrado'; end if;
    if coalesce(v_order.is_paid, false) or coalesce(v_order.paid_externally, false) or v_order.stage = 'cancelled' then
      raise exception 'Não é possível alterar o voucher de um pedido fechado';
    end if;
    if exists (
      select 1 from public.payment_splits p
      where p.order_id = p_order_id and p.status not in ('refunded', 'canceled', 'cancelled')
    ) then
      raise exception 'Remova o pagamento dividido antes de alterar o voucher';
    end if;

    select coalesce(nullif(reg.whatsapp, ''), nullif(c.whatsapp, ''))
    into v_phone
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join lateral (
      select r.whatsapp from public.customer_registrations r
      where r.order_id = o.id order by r.created_at desc limit 1
    ) reg on true
    where o.id = p_order_id;

    v_old := v_order.voucher_id;
    v_old_amount := coalesce(v_order.voucher_amount, 0);
    v_subtotal := coalesce((
      select sum(coalesce(nullif(item->>'price', '')::numeric, 0) * coalesce(nullif(item->>'quantity', '')::numeric, 1))
      from jsonb_array_elements(coalesce(v_order.products, '[]'::jsonb)) item
    ), 0);
    v_discount := case
      when v_order.discount_type = 'percentage' then v_subtotal * coalesce(v_order.discount_value, 0) / 100
      else coalesce(v_order.discount_value, 0)
    end;
    v_shipping := case when v_order.free_shipping then 0 else coalesce(v_order.shipping_cost, 0) end;

    if p_voucher_id is null then
      v_new_discount := greatest(0, v_discount - v_old_amount);
      update public.orders set
        voucher_id = null,
        voucher_amount = 0,
        discount_type = case when v_new_discount > 0 then 'fixed' else null end,
        discount_value = v_new_discount
      where id = p_order_id;
      return query select null::uuid, 0::numeric,
        case when v_new_discount > 0 then 'fixed' else null end,
        v_new_discount,
        round(greatest(0, v_subtotal - v_new_discount + v_shipping), 2);
      return;
    end if;

    select * into v_voucher from public.vouchers where id = p_voucher_id for update;
    if not found then raise exception 'Voucher não encontrado'; end if;
    if v_voucher.status <> 'ativo' or v_voucher.saldo <= 0 then raise exception 'Voucher já utilizado ou sem saldo'; end if;
    if v_voucher.validade is not null and v_voucher.validade < current_date then raise exception 'Voucher expirado'; end if;

    select right(regexp_replace(coalesce(pc.whatsapp, ''), '\D', '', 'g'), 8)
    into v_voucher_suffix from public.pos_customers pc where pc.id = v_voucher.cliente_id;
    v_suffix := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 8);
    if length(v_suffix) <> 8 or v_voucher_suffix is distinct from v_suffix then
      raise exception 'Este voucher pertence a outro WhatsApp';
    end if;
    if exists (
      select 1 from public.orders o
      where o.voucher_id = p_voucher_id and o.id <> p_order_id and o.stage <> 'cancelled'
    ) or exists (
      select 1 from public.pos_sales s
      where s.voucher_id = p_voucher_id and coalesce(s.status, '') not in ('cancelled', 'refunded')
    ) then
      raise exception 'Voucher já reservado em outro pedido';
    end if;

    v_base := greatest(0, v_subtotal - v_discount + v_old_amount);
    v_amount := round(least(v_voucher.saldo, v_base), 2);
    if v_amount <= 0 then raise exception 'Não há valor de produtos para abater'; end if;
    v_new_discount := greatest(0, v_discount - v_old_amount + v_amount);
    update public.orders set
      voucher_id = p_voucher_id,
      voucher_amount = v_amount,
      discount_type = 'fixed',
      discount_value = v_new_discount
    where id = p_order_id;
    return query select p_voucher_id, v_amount, 'fixed'::text, v_new_discount,
      round(greatest(0, v_subtotal - v_new_discount + v_shipping), 2);
    return;
  end if;

  select * into v_sale from public.pos_sales where id = p_sale_id for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if coalesce(v_sale.status, '') in ('paid', 'completed', 'pending_pickup', 'cancelled', 'refunded') then
    raise exception 'Não é possível alterar o voucher de uma venda fechada';
  end if;
  if exists (
    select 1 from public.payment_splits p
    where p.sale_id = p_sale_id and p.status not in ('refunded', 'canceled', 'cancelled')
  ) then
    raise exception 'Remova o pagamento dividido antes de alterar o voucher';
  end if;

  select coalesce(nullif(s.customer_phone, ''), nullif(pc.whatsapp, ''))
  into v_phone
  from public.pos_sales s left join public.pos_customers pc on pc.id = s.customer_id
  where s.id = p_sale_id;
  v_old := v_sale.voucher_id;
  v_old_amount := coalesce(v_sale.voucher_amount, 0);
  v_shipping := case
    when coalesce(v_sale.payment_details->>'free_shipping', '') = 'true' then 0
    else coalesce(v_sale.shipping_cost, nullif(v_sale.payment_details->>'shipping_amount', '')::numeric, 0)
  end;

  if p_voucher_id is null then
    v_new_discount := greatest(0, coalesce(v_sale.discount, 0) - v_old_amount);
    v_total := round(greatest(0, coalesce(v_sale.total, 0) + v_old_amount), 2);
    update public.pos_sales set
      voucher_id = null,
      voucher_amount = 0,
      discount = v_new_discount,
      total = v_total
    where id = p_sale_id;
    return query select null::uuid, 0::numeric, 'fixed'::text, v_new_discount, v_total;
    return;
  end if;

  select * into v_voucher from public.vouchers where id = p_voucher_id for update;
  if not found then raise exception 'Voucher não encontrado'; end if;
  if v_voucher.status <> 'ativo' or v_voucher.saldo <= 0 then raise exception 'Voucher já utilizado ou sem saldo'; end if;
  if v_voucher.validade is not null and v_voucher.validade < current_date then raise exception 'Voucher expirado'; end if;

  select right(regexp_replace(coalesce(pc.whatsapp, ''), '\D', '', 'g'), 8)
  into v_voucher_suffix from public.pos_customers pc where pc.id = v_voucher.cliente_id;
  v_suffix := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 8);
  if v_voucher.cliente_id is distinct from v_sale.customer_id
    and (length(v_suffix) <> 8 or v_voucher_suffix is distinct from v_suffix) then
    raise exception 'Este voucher pertence a outro WhatsApp';
  end if;
  if exists (
    select 1 from public.orders o
    where o.voucher_id = p_voucher_id and o.stage <> 'cancelled'
  ) or exists (
    select 1 from public.pos_sales s
    where s.voucher_id = p_voucher_id and s.id <> p_sale_id and coalesce(s.status, '') not in ('cancelled', 'refunded')
  ) then
    raise exception 'Voucher já reservado em outro pedido';
  end if;

  v_base := greatest(0, coalesce(v_sale.total, 0) + v_old_amount - v_shipping);
  v_amount := round(least(v_voucher.saldo, v_base), 2);
  if v_amount <= 0 then raise exception 'Não há valor de produtos para abater'; end if;
  v_new_discount := greatest(0, coalesce(v_sale.discount, 0) - v_old_amount + v_amount);
  v_total := round(greatest(0, coalesce(v_sale.total, 0) + v_old_amount - v_amount), 2);
  update public.pos_sales set
    voucher_id = p_voucher_id,
    voucher_amount = v_amount,
    discount = v_new_discount,
    total = v_total
  where id = p_sale_id;
  return query select p_voucher_id, v_amount, 'fixed'::text, v_new_discount, v_total;
end;
$function$;

revoke all on function public.set_target_voucher(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_target_voucher(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.get_checkout_order_has_cashback(p_order_id uuid, p_token text default null)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (
    o.cashback_id is not null or coalesce(o.cashback_amount, 0) > 0
    or o.voucher_id is not null or coalesce(o.voucher_amount, 0) > 0
  )
  from public.orders o
  where o.id = p_order_id
    and (o.checkout_token is null or o.checkout_token = p_token)
$function$;

create or replace function public.redeem_order_cashback_on_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.cashback_id is not null and NEW.is_paid = true
     and (TG_OP = 'INSERT' or coalesce(OLD.is_paid, false) = false or OLD.cashback_id is distinct from NEW.cashback_id) then
    update public.internal_cashback
       set is_used = true, used_at = now(), used_channel = 'live', used_external_ref = NEW.id::text, updated_at = now()
     where id = NEW.cashback_id and is_used = false;
  end if;
  if NEW.voucher_id is not null and (NEW.is_paid = true or NEW.paid_externally = true)
     and (TG_OP = 'INSERT' or (coalesce(OLD.is_paid, false) = false and coalesce(OLD.paid_externally, false) = false)
          or OLD.voucher_id is distinct from NEW.voucher_id) then
    update public.vouchers
       set status = 'usado', saldo = 0, used_at = coalesce(used_at, now()), used_order_id = NEW.id, updated_at = now()
     where id = NEW.voucher_id and status = 'ativo';
  end if;
  return NEW;
end;
$function$;

create or replace function public.trg_pos_sales_recalc_after()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.voucher_id is not null
     and NEW.status in ('completed', 'paid', 'pending_pickup')
     and (TG_OP = 'INSERT' or coalesce(OLD.status, '') not in ('completed', 'paid', 'pending_pickup')) then
    update public.vouchers
       set status = 'usado', saldo = 0, used_at = coalesce(used_at, now()), used_sale_id = NEW.id, updated_at = now()
     where id = NEW.voucher_id and status = 'ativo';
  end if;
  if NEW.customer_unified_id is not null then
    perform public.recalc_customer_metrics(NEW.customer_unified_id);
  end if;
  if TG_OP = 'UPDATE' and OLD.customer_unified_id is not null and OLD.customer_unified_id is distinct from NEW.customer_unified_id then
    perform public.recalc_customer_metrics(OLD.customer_unified_id);
  end if;
  return null;
end;
$function$;

revoke all on function public.get_checkout_order_has_cashback(uuid, text) from public;
grant execute on function public.get_checkout_order_has_cashback(uuid, text) to anon, authenticated, service_role;
revoke all on function public.redeem_order_cashback_on_paid() from public, anon, authenticated;
grant execute on function public.redeem_order_cashback_on_paid() to service_role;
revoke all on function public.trg_pos_sales_recalc_after() from public, anon, authenticated;
grant execute on function public.trg_pos_sales_recalc_after() to service_role;
