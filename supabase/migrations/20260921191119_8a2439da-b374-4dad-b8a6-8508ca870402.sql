create or replace function public.live_link_open_status(p_order_ids uuid[])
returns table(order_id uuid, opened_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select t.order_id, max(t.opened_at) as opened_at
  from (
    select s.order_id, max(coalesce(s.last_seen_at, s.created_at)) as opened_at
    from public.live_member_sessions s
    where s.order_id = any(p_order_ids)
    group by s.order_id
    union all
    select m.order_id, max(m.last_used_at) as opened_at
    from public.member_area_magic_links m
    where m.order_id = any(p_order_ids)
      and m.last_used_at is not null
    group by m.order_id
  ) t
  group by t.order_id
$$;

revoke all on function public.live_link_open_status(uuid[]) from public, anon;
grant execute on function public.live_link_open_status(uuid[]) to authenticated, service_role;