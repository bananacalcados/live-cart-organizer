create or replace function public.inventory_claim_correction_batch(p_count_id uuid, p_batch_size int)
returns setof public.inventory_correction_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.inventory_correction_queue q
  set status = 'processing', attempts = q.attempts + 1, updated_at = now()
  where q.id in (
    select id from public.inventory_correction_queue
    where count_id = p_count_id
      and status in ('pending','error')
      and attempts < 5
    order by created_at asc
    limit p_batch_size
    for update skip locked
  )
  returning q.*;
end;
$$;

grant execute on function public.inventory_claim_correction_batch(uuid, int) to service_role;
grant execute on function public.inventory_claim_correction_batch(uuid, int) to authenticated;