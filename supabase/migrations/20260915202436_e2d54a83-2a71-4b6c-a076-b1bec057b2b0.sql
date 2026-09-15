CREATE OR REPLACE FUNCTION public.get_relatorio_grade_live(p_live_id uuid, p_status text DEFAULT 'pago'::text, p_incluir_anterior boolean DEFAULT false)
 RETURNS TABLE(produto_nome text, cor text, total_vendido integer, grades integer, status text, vendidos jsonb, vender_mais jsonb, tamanhos_estouro text[], grade_cheia boolean, tamanhos_fora_da_grade jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with atual as (
  select e.id, coalesce(e.start_date, e.created_at::date) as d, e.created_at
  from events e where e.id = p_live_id
),
anterior as (
  select e.id
  from events e, atual a
  where p_incluir_anterior
    and e.id <> p_live_id
    and (coalesce(e.start_date, e.created_at::date), e.created_at) < (a.d, a.created_at)
    and exists (select 1 from orders o where o.event_id = e.id)
  order by coalesce(e.start_date, e.created_at::date) desc, e.created_at desc
  limit 1
),
lives as (
  select p_live_id as id
  union
  select id from anterior
),
grade(tam, qtd) as (
  values ('34',1),('35',2),('36',3),('37',3),('38',2),('39',1)
),
pedidos as (
  select o.id, o.products
  from orders o
  where o.event_id in (select id from lives)
    and coalesce(o.stage,'') <> 'cancelled'
    and o.merged_into_order_id is null
    and (
      case
        when p_status = 'pago' then
          (coalesce(o.is_paid,false)
           or coalesce(o.paid_externally,false)
           or o.stage in ('paid','awaiting_shipping','awaiting_mototaxi',
                          'awaiting_pickup','shipped','completed'))
        when p_status = 'nao_pago' then
          not (coalesce(o.is_paid,false)
           or coalesce(o.paid_externally,false)
           or o.stage in ('paid','awaiting_shipping','awaiting_mototaxi',
                          'awaiting_pickup','shipped','completed'))
        else true
      end
    )
),
itens as (
  select
    trim(item->>'title')                          as produto_nome,
    trim(split_part(item->>'variant', ' / ', 1))  as cor,
    trim(split_part(item->>'variant', ' / ', 2))  as tamanho,
    coalesce((item->>'quantity')::int, 1)         as qtd
  from pedidos p
  cross join lateral jsonb_array_elements(p.products) as item
  where p.products is not null
    and jsonb_typeof(p.products) = 'array'
),
itens_agg as (
  select produto_nome, cor, tamanho, sum(qtd)::int as qtd
  from itens
  where produto_nome <> '' and cor <> '' and tamanho <> ''
  group by produto_nome, cor, tamanho
),
grupos as (
  select distinct produto_nome, cor from itens_agg
),
padrao as (
  select i.produto_nome, i.cor, i.tamanho, i.qtd, g.qtd as grade_qtd
  from itens_agg i join grade g on g.tam = i.tamanho
),
fora as (
  select i.produto_nome, i.cor, i.tamanho, i.qtd
  from itens_agg i left join grade g on g.tam = i.tamanho
  where g.tam is null
),
n_por_grupo as (
  select produto_nome, cor, max(ceil(qtd::numeric / grade_qtd))::int as n
  from padrao group by produto_nome, cor
),
niveis as (
  select
    gp.produto_nome, gp.cor, gr.tam, gr.qtd as grade_qtd,
    coalesce(p.qtd,0) as vendido,
    coalesce(n.n,0)   as n,
    (coalesce(n.n,0) * gr.qtd - coalesce(p.qtd,0)) as restante,
    (coalesce(n.n,0) > 1
      and ceil(coalesce(p.qtd,0)::numeric / gr.qtd)::int = coalesce(n.n,0)
      and coalesce(p.qtd,0) > 0) as estouro
  from grupos gp
  cross join grade gr
  left join padrao p on p.produto_nome=gp.produto_nome and p.cor=gp.cor and p.tamanho=gr.tam
  left join n_por_grupo n on n.produto_nome=gp.produto_nome and n.cor=gp.cor
),
por_grupo as (
  select
    produto_nome, cor,
    max(n) as n,
    sum(vendido)::int as total_vendido,
    coalesce(jsonb_agg(jsonb_build_object('tam',tam,'qtd',vendido,'estouro',estouro)
             order by tam) filter (where vendido > 0), '[]'::jsonb) as vendidos,
    coalesce(jsonb_agg(jsonb_build_object('tam',tam,'qtd',restante)
             order by restante desc, grade_qtd desc) filter (where restante > 0), '[]'::jsonb) as vender_mais,
    coalesce(array_agg(tam order by tam) filter (where estouro), '{}') as tamanhos_estouro,
    (sum(restante) = 0) as grade_cheia
  from niveis
  group by produto_nome, cor
),
fora_grupo as (
  select produto_nome, cor,
    jsonb_agg(jsonb_build_object('tam',tamanho,'qtd',qtd) order by tamanho) as fora
  from fora group by produto_nome, cor
),
final as (
  select
    pg.produto_nome,
    pg.cor,
    pg.total_vendido,
    pg.n as grades,
    case
      when pg.total_vendido = 0 then 'sem_grade'
      when pg.total_vendido <  3 * pg.n then 'prejuizo'
      when pg.total_vendido =  3 * pg.n then 'empate'
      else 'lucro'
    end as status,
    pg.vendidos,
    pg.vender_mais,
    pg.tamanhos_estouro,
    pg.grade_cheia,
    coalesce(fg.fora, '[]'::jsonb) as tamanhos_fora_da_grade
  from por_grupo pg
  left join fora_grupo fg on fg.produto_nome=pg.produto_nome and fg.cor=pg.cor
)
select *
from final f
order by
  case f.status when 'prejuizo' then 0 when 'empate' then 1 else 2 end,
  f.produto_nome, f.cor;
$function$;

CREATE OR REPLACE FUNCTION public.get_live_anterior_grade(p_live_id uuid)
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with atual as (
    select coalesce(e.start_date, e.created_at::date) as d, e.created_at
    from events e where e.id = p_live_id
  )
  select e.id, e.name
  from events e, atual a
  where e.id <> p_live_id
    and (coalesce(e.start_date, e.created_at::date), e.created_at) < (a.d, a.created_at)
    and exists (select 1 from orders o where o.event_id = e.id)
  order by coalesce(e.start_date, e.created_at::date) desc, e.created_at desc
  limit 1;
$function$;