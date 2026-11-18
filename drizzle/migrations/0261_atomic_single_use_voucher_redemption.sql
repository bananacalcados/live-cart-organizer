alter table public.vouchers add column if not exists used_exchange_id uuid;

create or replace function public.redeem_voucher_once(
  p_voucher_id uuid,
  p_sale_id uuid default null,
  p_exchange_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale_status text;
  v_exchange_status text;
begin
  if not (auth.role() = 'service_role' or public.is_team_member(auth.uid())) then
    raise exception 'Acesso negado';
  end if;
  if (p_sale_id is null) = (p_exchange_id is null) then
    raise exception 'Informe a venda ou a troca que usou o voucher';
  end if;

  if p_sale_id is not null then
    select status into v_sale_status from public.pos_sales where id = p_sale_id for update;
    if not found then raise exception 'Venda não encontrada'; end if;
    if coalesce(v_sale_status, '') not in ('paid', 'completed', 'pending_pickup') then
      raise exception 'A venda ainda não foi concluída';
    end if;
  else
    select status::text into v_exchange_status from public.trocas_devolucoes where id = p_exchange_id for update;
    if not found then raise exception 'Troca não encontrada'; end if;
    if coalesce(v_exchange_status, '') not in ('concluida', 'aguardando_envio') then
      raise exception 'A troca ainda não foi concluída';
    end if;
  end if;

  perform 1 from public.vouchers where id = p_voucher_id for update;
  if not found then raise exception 'Voucher não encontrado'; end if;
  if exists (select 1 from public.vouchers where id = p_voucher_id and (status <> 'ativo' or saldo <= 0)) then
    raise exception 'Voucher já utilizado ou sem saldo';
  end if;
  if exists (select 1 from public.vouchers where id = p_voucher_id and validade is not null and validade < current_date) then
    raise exception 'Voucher expirado';
  end if;

  update public.vouchers set
    status = 'usado',
    saldo = 0,
    used_at = coalesce(used_at, now()),
    used_sale_id = p_sale_id,
    used_exchange_id = p_exchange_id,
    updated_at = now()
  where id = p_voucher_id and status = 'ativo';
end;
$function$;

revoke all on function public.redeem_voucher_once(uuid, uuid, uuid) from public, anon;
grant execute on function public.redeem_voucher_once(uuid, uuid, uuid) to authenticated, service_role;
