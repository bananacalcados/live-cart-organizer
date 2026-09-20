CREATE OR REPLACE FUNCTION public.get_relatorio_grade_expedicao(p_sale_ids uuid[])
 RETURNS TABLE(produto_nome text, cor text, total_vendido integer, grades integer, status text, vendidos jsonb, vender_mais jsonb, tamanhos_estouro text[], grade_cheia boolean, tamanhos_fora_da_grade jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with grade(tam, qtd) as (
  values ('34',1),('35',2),('36',3),('37',3),('38',2),('39',1)
),
itens as (
  select
    trim(coalesce(i.product_name,''))                                as produto_nome,
    trim(split_part(coalesce(i.variant_name,''), ' / ', 1))          as cor,
    trim(coalesce(nullif(i.size,''), split_part(coalesce(i.variant_name,''), ' / ', 2))) as tamanho,
    coalesce(i.quantity, 1)                                          as qtd
  from pos_sale_items i
  where i.sale_id = any(p_sale_ids)
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

GRANT EXECUTE ON FUNCTION public.get_relatorio_grade_expedicao(uuid[]) TO authenticated, service_role;