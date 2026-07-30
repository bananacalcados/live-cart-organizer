with base as (
  select o.id,
    coalesce((select sum((p->>'price')::numeric*(p->>'quantity')::numeric) from jsonb_array_elements(o.products) p),0) as sub,
    case when o.discount_type='percentage' then coalesce((select sum((p->>'price')::numeric*(p->>'quantity')::numeric) from jsonb_array_elements(o.products) p),0)*coalesce(o.discount_value,0)/100
         else coalesce(o.discount_value,0) end as disc,
    e.default_shipping_cost, e.free_shipping_threshold
  from orders o join events e on e.id=o.event_id
  where o.is_paid=false
    and e.free_shipping_threshold is not null and e.default_shipping_cost>0
    and o.free_shipping=true
    and coalesce(o.shipping_info->>'source','') <> 'member_area'
)
update orders o
set free_shipping=false, shipping_cost=b.default_shipping_cost,
    shipping_info=jsonb_build_object('source','event_rule','carrier','Frete fixo do evento','price',b.default_shipping_cost,'applied_at',now()::text)
from base b
where o.id=b.id and greatest(b.sub-b.disc,0) < b.free_shipping_threshold;