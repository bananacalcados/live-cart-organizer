drop function if exists public.get_relatorio_grade_expedicao(uuid[]);

create or replace function public.get_relatorio_grade_expedicao(p_sale_ids uuid[])
returns table(
  produto_nome text, cor text, total_vendido integer, grades integer, status text,
  vendidos jsonb, vender_mais jsonb, tamanhos_estouro text[], grade_cheia boolean,
  tamanhos_fora_da_grade jsonb, tipo_grade text, custo_unitario numeric, custo_total numeric
)
language sql
stable
set search_path to 'public'
as $function$
with grades_def(tipo, tam, qtd) as (
  values ('baixa','34',1),('baixa','35',2),('baixa','36',3),('baixa','37',3),('baixa','38',2),('baixa','39',1),
         ('alta','38',1),('alta','39',2),('alta','40',3),('alta','41',3),('alta','42',2),('alta','43',1)
),
itens as (
  select
    trim(coalesce(i.product_name,''))                                as produto_nome,
    trim(split_part(coalesce(i.variant_name,''), ' / ', 1))          as cor,
    trim(coalesce(nullif(i.size,''), split_part(coalesce(i.variant_name,''), ' / ', 2))) as tamanho,
    coalesce(i.quantity, 1)                                          as qtd,
    nullif(trim(coalesce(i.barcode,'')),'')                          as barcode,
    nullif(trim(coalesce(i.sku,'')),'')                              as sku
  from pos_sale_items i
  where i.sale_id = any(p_sale_ids)
),
itens_ok as (
  select * from itens where produto_nome <> '' and cor <> '' and tamanho <> ''
),
itens_agg as (
  select produto_nome, cor, tamanho, sum(qtd)::int as qtd
  from itens_ok group by 1,2,3
),
custos as (
  select i.produto_nome, i.cor, avg(nullif(p.cost_price,0))::numeric as custo
  from itens_ok i
  join pos_products p
    on (i.barcode is not null and p.barcode = i.barcode)
    or (i.sku is not null and p.sku = i.sku)
  group by 1,2
),
tipos as (
  select produto_nome, cor,
    case
      when sum(case when tamanho ~ '^[0-9]+$' then qtd else 0 end) = 0 then 'letras'
      when sum(case when tamanho in ('40','41','42','43') then qtd else 0 end)
         > sum(case when tamanho in ('34','35','36','37') then qtd else 0 end) then 'alta'
      else 'baixa'
    end as tipo
  from itens_agg group by 1,2
),
grupos as (
  select t.produto_nome, t.cor, t.tipo from tipos t where t.tipo <> 'letras'
),
padrao as (
  select i.produto_nome, i.cor, i.tamanho, i.qtd, g.qtd as grade_qtd
  from itens_agg i
  join grupos gp on gp.produto_nome=i.produto_nome and gp.cor=i.cor
  join grades_def g on g.tipo = gp.tipo and g.tam = i.tamanho
),
fora as (
  select i.produto_nome, i.cor, i.tamanho, i.qtd
  from itens_agg i
  join grupos gp on gp.produto_nome=i.produto_nome and gp.cor=i.cor
  left join grades_def g on g.tipo = gp.tipo and g.tam = i.tamanho
  where g.tam is null
),
n_por_grupo as (
  select produto_nome, cor, max(ceil(qtd::numeric / grade_qtd))::int as n
  from padrao group by 1,2
),
niveis as (
  select
    gp.produto_nome, gp.cor, gp.tipo, gr.tam, gr.qtd as grade_qtd,
    coalesce(p.qtd,0) as vendido,
    coalesce(n.n,0)   as n,
    (coalesce(n.n,0) * gr.qtd - coalesce(p.qtd,0)) as restante,
    (coalesce(n.n,0) > 1
      and ceil(coalesce(p.qtd,0)::numeric / gr.qtd)::int = coalesce(n.n,0)
      and coalesce(p.qtd,0) > 0) as estouro
  from grupos gp
  join grades_def gr on gr.tipo = gp.tipo
  left join padrao p on p.produto_nome=gp.produto_nome and p.cor=gp.cor and p.tamanho=gr.tam
  left join n_por_grupo n on n.produto_nome=gp.produto_nome and n.cor=gp.cor
),
por_grupo as (
  select
    produto_nome, cor, min(tipo) as tipo,
    max(n) as n,
    sum(vendido)::int as total_vendido,
    coalesce(jsonb_agg(jsonb_build_object('tam',tam,'qtd',vendido,'estouro',estouro)
             order by tam) filter (where vendido > 0), '[]'::jsonb) as vendidos,
    coalesce(jsonb_agg(jsonb_build_object('tam',tam,'qtd',restante)
             order by restante desc, grade_qtd desc) filter (where restante > 0), '[]'::jsonb) as vender_mais,
    coalesce(array_agg(tam order by tam) filter (where estouro), '{}') as tamanhos_estouro,
    (sum(restante) = 0) as grade_cheia
  from niveis group by 1,2
),
fora_grupo as (
  select produto_nome, cor,
    jsonb_agg(jsonb_build_object('tam',tamanho,'qtd',qtd) order by tamanho) as fora
  from fora group by 1,2
),
numericos as (
  select
    pg.produto_nome, pg.cor, pg.total_vendido, pg.n as grades,
    case
      when pg.total_vendido = 0 then 'sem_grade'
      when pg.total_vendido <  3 * pg.n then 'prejuizo'
      when pg.total_vendido =  3 * pg.n then 'empate'
      else 'lucro'
    end as status,
    pg.vendidos, pg.vender_mais, pg.tamanhos_estouro, pg.grade_cheia,
    coalesce(fg.fora, '[]'::jsonb) as tamanhos_fora_da_grade,
    pg.tipo as tipo_grade,
    round(coalesce(c.custo,0),2) as custo_unitario,
    round(coalesce(c.custo,0) * 12 * pg.n, 2) as custo_total
  from por_grupo pg
  left join fora_grupo fg on fg.produto_nome=pg.produto_nome and fg.cor=pg.cor
  left join custos c on c.produto_nome=pg.produto_nome and c.cor=pg.cor
),
letras as (
  select
    a.produto_nome, a.cor,
    sum(a.qtd)::int as total_vendido,
    sum(a.qtd)::int as grades,
    case when sum(a.qtd) > 0 then 'lucro' else 'sem_grade' end as status,
    coalesce(jsonb_agg(jsonb_build_object('tam',a.tamanho,'qtd',a.qtd,'estouro',false)
             order by a.tamanho), '[]'::jsonb) as vendidos,
    '[]'::jsonb as vender_mais,
    '{}'::text[] as tamanhos_estouro,
    true as grade_cheia,
    '[]'::jsonb as tamanhos_fora_da_grade,
    'letras' as tipo_grade,
    round(coalesce(min(c.custo),0),2) as custo_unitario,
    round(coalesce(min(c.custo),0) * sum(a.qtd), 2) as custo_total
  from itens_agg a
  join tipos t on t.produto_nome=a.produto_nome and t.cor=a.cor and t.tipo='letras'
  left join custos c on c.produto_nome=a.produto_nome and c.cor=a.cor
  group by 1,2
),
final as (
  select * from numericos
  union all
  select * from letras
)
select *
from final f
order by
  case f.status when 'prejuizo' then 0 when 'empate' then 1 else 2 end,
  f.produto_nome, f.cor;
$function$;

grant execute on function public.get_relatorio_grade_expedicao(uuid[]) to authenticated, service_role;