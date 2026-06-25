# Construtor de Públicos com Inclusão e Exclusão — Online > Automações

## Objetivo
Permitir montar públicos para as campanhas de carrossel combinando **filtros de INCLUSÃO** e **filtros de EXCLUSÃO** (interseção), com os 9 critérios pedidos. Nada do que já existe é quebrado: o motor atual de campanhas continua funcionando com campanhas antigas.

## O que já está pronto (não precisa criar dado novo)
A view `crm_customers_v` (fonte única do CRM) já entrega por cliente:
- **Tamanho** → `purchased_sizes`
- **Cidade** → `city`
- **DDD** → `ddd`
- **Ticket médio** → `avg_ticket`
- **Quantidade de compras** → `total_orders`
- **Categoria de produtos** → `purchased_categories`
- **Marcas** → `purchased_brands`

## O que falta como dado (2 dos 9)
- **Lojas** e **Formas de pagamento** ainda não existem agregados por cliente.

---

## Etapa 1 — Dados faltantes (loja e forma de pagamento)

Reaproveita o mecanismo que já popula tamanhos/marcas/categorias (`recalc_customer_product_attributes` + trigger em `pos_sale_items`).

1. Adicionar em `customers_unified`: `purchased_stores text[]` e `payment_methods text[]`.
2. Criar função `parse_payment_methods(texto)` que normaliza o texto livre de `pos_sales.payment_method` (hoje vem como `"Pix (R$49.99) + Cartão de crédito 4x..."`) para rótulos canônicos:
   - `Pix`, `Cartão de crédito`, `Cartão de débito`, `Crediário` (inclui gateways vindi/appmax/boleto/crediário), `VP` (Vale-presente/Vps), e também `Dinheiro` / `Vale-troca` para completude.
3. Estender `recalc_customer_product_attributes` para também agregar:
   - `purchased_stores` = nomes das lojas (`pos_stores.name`) onde o cliente comprou;
   - `payment_methods` = união normalizada das formas usadas.
4. Backfill único de toda a base e expor as 2 colunas novas na `crm_customers_v`.

Sem CHECK constraints (uso de função/normalização). GRANTs já existem na tabela.

## Etapa 2 — Formato do filtro (incluir + excluir) sem quebrar o legado

Hoje `campanhas_auto.filtro_json` é um objeto plano (só inclusão). Novo formato:

```text
{
  "include": { sizes:[], cities:[], ddds:[], categories:[], brands:[],
               stores:[], payment_methods:[],
               min_avg_ticket, max_avg_ticket,
               min_total_orders, max_total_orders },
  "exclude": { ...mesmos campos... }
}
```

Compatibilidade: o motor detecta o formato. Se o JSON **não** tiver `include`/`exclude`, ele é tratado como `include` (campanhas antigas seguem idênticas).

## Etapa 3 — Motor de seleção (RPC `select_campaign_batch`)

Atualizar a função para aplicar, em interseção (AND entre blocos):
- Cada filtro de `include` restringe o público (quando preenchido).
- Cada filtro de `exclude` remove quem casar (quando preenchido).
- Arrays (tamanho, categoria, marca, loja, pagamento) usam sobreposição (`&&`); cidade/DDD usam pertencimento; ticket/qtd usam faixa min/max.

Mantém intactas as regras já existentes: opt-out, arquivados, carência da campanha (`cooldown_dias`) e teto global de 7 dias.

Exemplos do usuário ficam expressos como:
- Valadares-MG **sem** crediário/VP → include: `cities=[Governador Valadares]`; exclude: `payment_methods=[Crediário, VP]`.
- Quem comprou +2x com ticket ~R$250 **fora** de Valadares → include: `min_total_orders=2, min_avg_ticket=250`; exclude: `cities=[Governador Valadares]`.

## Etapa 4 — Contagem ao vivo (preview do público)

Nova RPC `count_campaign_audience(filtro_json)` que devolve quantos clientes o público atinge, para mostrar o número em tempo real enquanto a pessoa monta os filtros (sem disparar nada).

## Etapa 5 — Interface (frontend) na aba Online > Automações

Criar `AudienceFilterBuilder.tsx`, um bloco com duas seções claramente separadas:
- **✅ INCLUIR** e **🚫 EXCLUIR**, cada uma com os 9 filtros (multiseleção para tamanho/cidade/DDD/categoria/marca/loja/forma de pagamento; faixas numéricas para ticket médio e quantidade de compras).
- As opções de cada lista (cidades, marcas, tamanhos, lojas etc.) vêm de uma RPC de "valores distintos" para preencher os seletores.
- Rodapé com **"Público estimado: N clientes"** atualizado ao vivo.

Integrado ao fluxo de criação/edição de campanha que já existe sob Automações; o JSON montado é salvo em `campanhas_auto.filtro_json` no novo formato.

## Garantias de não-quebra
- Campanhas já criadas continuam válidas (fallback de formato legado no motor).
- Colunas novas são aditivas (`ADD COLUMN IF NOT EXISTS`), sem alterar as existentes.
- Nenhuma mudança nos workers de envio, no rodízio de vendedoras ou no teto global.

---

## Detalhes técnicos (resumo)
- **Migração 1:** colunas + `parse_payment_methods` + extensão de `recalc_customer_product_attributes` + backfill + recriação da `crm_customers_v` com as 2 colunas novas.
- **Migração 2:** novas versões de `select_campaign_batch` (include/exclude + 2 dimensões novas) e `count_campaign_audience` + RPC de valores distintos para os seletores.
- **Frontend:** `AudienceFilterBuilder.tsx` + integração no editor de campanha em `POSOnlineHub`/Automações.
- Sem alterar `pos_sales`, workers, ou estrutura de envios.
