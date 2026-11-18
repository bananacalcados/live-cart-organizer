drop function public.available_vouchers_for_target(text, uuid, uuid, integer, integer);

create function public.available_vouchers_for_target(
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
  applied_amount numeric,
  reserved_order_id uuid,
  reserved_sale_id uuid,
  is_available boolean
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
  v_staff_phone boolean := p_order_id is null and p_sale_id is null;
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
    case when v.id = v_current then v_applied else 0::numeric end,
    ro.id, rs.id,
    (
      not v_locked and v.status = 'ativo'
      and (
        (ro.id is null and rs.id is null)
        or ro.id = p_order_id
        or rs.id = p_sale_id
      )
    )
  from public.vouchers v
  join public.pos_customers owner on owner.id = v.cliente_id
  left join lateral (
    select o.id from public.orders o
    where o.voucher_id = v.id and o.stage <> 'cancelled' limit 1
  ) ro on true
  left join lateral (
    select s.id from public.pos_sales s
    where s.voucher_id = v.id and coalesce(s.status, '') not in ('cancelled', 'refunded') limit 1
  ) rs on true
  where (
    v.id = v_current
    or (
      v.status = 'ativo'
      and v.saldo > 0
      and (v.validade is null or v.validade >= current_date)
      and (
        (v_pos_customer is not null and v.cliente_id = v_pos_customer)
        or (
          length(v_suffix) = 8
          and right(regexp_replace(coalesce(owner.whatsapp, ''), '\D', '', 'g'), 8) = v_suffix
        )
      )
      and (
        v_staff_phone
        or (
          not v_locked
          and ((ro.id is null and rs.id is null) or ro.id = p_order_id or rs.id = p_sale_id)
        )
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
