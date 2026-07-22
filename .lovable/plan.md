# Matriz de Origem — Dashboard da Live

Adiciona ao dashboard interno de cada evento (Eventos > Live) uma matriz que classifica **compradores** e **não-compradores** por origem (Lead novo / Cliente antigo / Totalmente novo), com drill-down modal para investigar canal de aquisição.

Nada do que existe hoje é alterado. Toda a lógica nova entra em uma RPC separada e um card novo no `EventInnerDashboard`.

---

## 1. Regra-mãe de matching (crítica)

Como no evento o pedido nasce com `@instagram` e nossas bases (`customers_unified`, `lp_leads`, `event_leads`, `catalog_lead_registrations`, `chat_contacts`, `zoppy_customers`, `ravena_customers`) não guardam `@`, o único vínculo confiável é telefone.

Padrão obrigatório (já usado no CRM):
- Normaliza para dígitos, remove 55 inicial.
- Chave de match = **DDD (2 díg.) + últimos 8 dígitos**.
- Compara sempre por essa chave, nunca pelo telefone bruto.

Uma função SQL utilitária `event_phone_key(text)` centraliza isso e é reusada em todas as buscas do relatório.

## 2. Definição de cada bucket

Para cada comprador do evento (fonte: `orders`/`pos_sales` do evento + `catalog_lead_registrations` com status `paid`):

- **Lead que virou cliente (1ª compra)**: existe em alguma tabela de lead (`lp_leads`, `event_leads`, `catalog_lead_registrations` de eventos anteriores, `chat_contacts` marcado como lead) **e** não tem venda anterior à data do evento em `pos_sales`/`orders`/`zoppy_sales`.
- **Cliente recorrente**: tem pelo menos 1 venda anterior à data do evento (em `customers_unified.total_purchases > 0` OU `pos_sales`/`zoppy_sales` anteriores).
- **Totalmente novo**: não bate em nenhum lead nem tem compra anterior.

Para não-compradores (fonte: `catalog_lead_registrations` do evento com `status != 'paid'` + `event_leads` do evento sem venda vinculada + `live_comments` classificados como `order` sem pedido pago):

- Aplica mesmos 3 buckets acima usando o telefone.
- Extra: motivo aparente (`abandoned_cart`, `checkout_started`, `only_comment`, `registered_only`).

## 3. Origem / canal de aquisição

Para o drill-down, cada pessoa recebe uma lista ordenada de "trilhas":

- Lead: qual tabela captou primeiro (`lp_leads.source`, `event_leads.source_event_id`, `catalog_lead_registrations.catalog_page_id`, `chat_contacts.origin`, typebot vs LP vs grupo VIP).
- Cliente: `customers_unified.acquisition_channel` + primeira venda (`pos_sales.channel`/`link_origin`) + presença em `zoppy_customers`/`ravena_customers`.
- Hábito: contagem de compras online vs presencial nos últimos 12 meses (`pos_sales.channel`).

## 4. Backend

Nova RPC `event_buyer_origin_matrix(p_event_id uuid)` retorna JSON:

```
{
  buyers: { leads_first_purchase, existing_customers, brand_new, total },
  non_buyers: { leads_first_purchase, existing_customers, brand_new, total, by_reason },
  buyer_list: [{ phone_key, name, instagram, bucket, order_id, value, sources[], first_seen_at }],
  non_buyer_list: [{ phone_key, name, instagram, bucket, reason, sources[], last_activity_at }]
}
```

Implementação:
- CTE `evt_people` unindo compradores e não-compradores do evento com `event_phone_key(whatsapp)`.
- LEFT JOINs contra `customers_unified`, `lp_leads`, `event_leads`, `catalog_lead_registrations` (excluindo o evento atual), `zoppy_customers`, `ravena_customers`, `chat_contacts` — todos por `phone_key`.
- Classificação em `CASE` dentro da CTE final.
- `STABLE`, `SECURITY DEFINER`, `SET search_path=public`, grant apenas para `authenticated`.

Índices adicionais (idempotentes) em colunas de telefone das tabelas de leads/clientes se não existirem, usando expressão `(regexp_replace(phone, '\D','','g'))` — só cria se faltar; não altera o que já existe.

## 5. Frontend

- `src/components/events/EventBuyerOriginMatrix.tsx` (novo): 2 cards lado a lado — "Compradores por origem" e "Não-compradores por origem", cada um com 3 blocos clicáveis + total.
- Ao clicar em qualquer bloco → `EventOriginDrilldownDialog.tsx` (novo) abre com a lista (nome, @, telefone mascarado, valor, bucket, fontes, botões WhatsApp/Instagram já no padrão do `EventCartsPanel`).
- Filtro secundário no drilldown: por bucket, por canal (typebot/LP/VIP/Zoppy/Ravena/PDV), busca por @.
- Integração: adicionar `<EventBuyerOriginMatrix eventId={eventId} />` logo abaixo do grid existente em `EventInnerDashboard.tsx`. Nenhuma métrica atual é removida ou movida.
- Loading, empty e error states isolados — se a RPC falhar, o resto do dashboard continua funcionando (try/catch local, card mostra fallback).

## 6. Cuidados para não quebrar nada

- Nenhuma alteração em tabelas existentes (só CREATE INDEX IF NOT EXISTS e CREATE FUNCTION).
- Não mexe em `event_inner_dashboard` (a RPC que já alimenta o dashboard).
- Componentes novos e isolados; import adicional em um único ponto (`EventInnerDashboard.tsx`).
- Matching por `phone_key` já validado no CRM (mem: Phone Formatting DDD+8).
- Ravena/Zoppy tratados como fonte de leitura apenas (respeita a regra de bypass já existente).

## 7. Entregáveis por fase

```text
Fase 1  SQL: event_phone_key() + índices + RPC event_buyer_origin_matrix
Fase 2  UI: EventBuyerOriginMatrix + EventOriginDrilldownDialog
Fase 3  Integração no EventInnerDashboard + QA em 2 eventos reais
```

Confirma que sigo com a Fase 1?
