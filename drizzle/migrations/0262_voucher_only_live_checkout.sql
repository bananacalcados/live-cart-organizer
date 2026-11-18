create or replace function public.pay_order_with_voucher(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
begin
  if not (auth.role() = 'service_role' or public.is_team_member(auth.uid())) then
    raise exception 'Acesso negado';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if coalesce(v_order.is_paid, false) or coalesce(v_order.paid_externally, false) then return; end if;
  if v_order.stage = 'cancelled' then raise exception 'Pedido cancelado'; end if;
  if v_order.voucher_id is null or coalesce(v_order.voucher_amount, 0) <= 0 then
    raise exception 'Nenhum voucher aplicado';
  end if;

  v_subtotal := coalesce((
    select sum(coalesce(nullif(item->>'price', '')::numeric, 0) * coalesce(nullif(item->>'quantity', '')::numeric, 1))
    from jsonb_array_elements(coalesce(v_order.products, '[]'::jsonb)) item
  ), 0);
  v_discount := case
    when v_order.discount_type = 'percentage' then v_subtotal * coalesce(v_order.discount_value, 0) / 100
    else coalesce(v_order.discount_value, 0)
  end;
  v_total := round(greatest(0, v_subtotal - v_discount + case when v_order.free_shipping then 0 else coalesce(v_order.shipping_cost, 0) end), 2);
  if v_total > 0.009 then raise exception 'Ainda falta pagar R$ %', v_total; end if;

  perform 1 from public.vouchers
  where id = v_order.voucher_id and status = 'ativo' and saldo >= v_order.voucher_amount
    and (validade is null or validade >= current_date)
  for update;
  if not found then raise exception 'Voucher já utilizado, sem saldo ou expirado'; end if;

  update public.orders set
    is_paid = true,
    paid_externally = true,
    paid_at = now(),
    stage = 'paid',
    payment_method_label = 'Vale-troca',
    installments = 1,
    payment_confirmed_source = 'manual'
  where id = p_order_id;
end;
$function$;

revoke all on function public.pay_order_with_voucher(uuid) from public, anon;
grant execute on function public.pay_order_with_voucher(uuid) to authenticated, service_role;
