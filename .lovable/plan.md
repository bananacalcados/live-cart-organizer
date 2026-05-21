# Fase 4 — Migração do App para `customers_unified`

## Escopo real medido

138 referências a tabelas legadas espalhadas pelo código:

| Tabela legada | Arquivos | Risco |
|---|---:|---|
| `customers` | 34 | alto (CRM, lives, chat, automações) |
| `pos_customers` | 33 | alto (PDV, fichas, vendas) |
| `zoppy_customers` | 28 | médio (RFM, dashboards, broadcasts) |
| `customer_registrations` | 17 | médio (checkout) |
| `chat_contacts` | 12 | alto (tudo do WhatsApp) |
| `instagram_user_links` | 4 | baixo |
| `customer_loyalty_points` | 3 | baixo (FK só) |
| `marketing_contacts` | 3 | médio (segmentação) |
| `ravena_customers` | 2 | baixo (legado) |
| `customer_prizes` | 5 | baixo (FK só) |

Migrar tudo de uma vez é receita pra parar o ERP. Vou em **5 ondas independentes**, cada uma testável e revertível.

## Estratégia: "compatibilidade dupla" durante a migração

Antes de tocar uma linha de código de leitura, crio uma **camada de espelhamento via trigger**:

```text
INSERT/UPDATE em customers, pos_customers, chat_contacts, zoppy_customers
                              │
                              ▼
              trigger AFTER INSERT/UPDATE
                              │
                              ▼
              UPSERT em customers_unified
                (matching por CPF > phone_suffix8 > instagram > email)
```

Assim o app antigo continua funcionando e `customers_unified` fica sempre fresca enquanto eu refatoro. Sem essa rede, qualquer cliente novo cadastrado durante a refatoração some.

## Ondas de refatoração

### Onda 0 — Infra de compatibilidade (1 migração)
1. Triggers de espelhamento em `customers`, `pos_customers`, `chat_contacts`, `zoppy_customers`, `customer_registrations`, `instagram_user_links` → upsert em `customers_unified` usando a mesma cascata de match do backfill.
2. Helper SQL `find_or_create_unified_customer(cpf, phone, instagram, email, name)` → reusado por triggers e edge functions.
3. Adicionar `unified_customer_id UUID` em `customer_loyalty_points` e `customer_prizes` (nullable, sem FK ainda) + backfill.

### Onda 1 — Hook + store de leitura unificada (sem quebrar nada)
- Criar `src/stores/unifiedCustomerStore.ts` (novo) que lê de `customers_unified`.
- Criar `useUnifiedCustomer(phone|cpf|instagram)` hook.
- `customerStore` antigo permanece, mas vira **proxy**: lê de `customers_unified` e mapeia para o shape `DbCustomer` que os componentes esperam. Zero alteração nos componentes que consomem `customerStore`.
- **Resultado: tela do CRM, ban list, lives e PDV já passam a mostrar a base unificada sem refatorar UI.**

### Onda 2 — Escrita do PDV e Checkout (origem de cadastros)
Refatorar quem **cria** cliente para gravar direto em `customers_unified` (e manter espelho temporário em `pos_customers`/`customer_registrations` para compatibilidade):
- `src/components/pos/CustomerForm.tsx` + `customerFormUtils`
- `src/components/pos/POSWhatsApp.tsx` (atribuição dinâmica)
- Edge functions: `pos-create-customer`, `transparent-checkout-*`, `livete-*-create-order`
- Lives: criação automática via Instagram

### Onda 3 — CRM / Broadcasts / Segmentação (leitura pesada)
- `src/components/management/CrmDuplicates.tsx` → some, deixa de fazer sentido.
- Broadcasts (`broadcast-*` edge functions) passam a filtrar em `customers_unified` + `customer_list_memberships`.
- RFM/segmentação lê de `customers_unified` (campos já existem).
- `useCrmPhoneLookup`, `useSupportPhones`, `useConversationEnrichment` apontam para unified.

### Onda 4 — Métricas (Fase 3 do plano original, encaixa aqui)
- Triggers em `orders`, `pos_sales`, `event_orders` recalculam `total_orders`, `total_spent`, `avg_ticket`, `last_purchase_at` em `customers_unified`.
- Substitui o trabalho que `zoppy_customers` fazia de fora.

### Onda 5 — FKs e limpeza preparatória
- `customer_loyalty_points.unified_customer_id` e `customer_prizes.unified_customer_id` ganham FK NOT NULL → `customers_unified.id`.
- `customer_registrations` ganha FK `unified_customer_id`.
- Desliga triggers de espelhamento (já não tem mais escrita nas legadas porque o código todo migrou).
- **Tabelas antigas viram read-only** (revoke INSERT/UPDATE) → começa a Fase 5 (observação).

## Critério de "pronto" por onda

Cada onda só fecha quando:
1. Build limpo (sem warnings de tipo).
2. Smoke test manual nas telas tocadas.
3. Comparação de contagens: `customers_unified` cresce no mesmo ritmo que as legadas durante a janela de overlap.

## O que entrego agora (este loop)

Apenas a **Onda 0** — triggers de espelhamento + helper SQL + colunas `unified_customer_id` em loyalty/prizes. Sem refatorar componente nenhum ainda.

Por quê: é a base que torna o resto seguro. Sem isso, qualquer onda seguinte corre risco de perder cadastros novos.

Depois que você validar a Onda 0 (testando criar 1 cliente no PDV e ver aparecer em `customers_unified`), abro a Onda 1.

## Riscos conhecidos

- **Conflito de match**: cliente novo do PDV pode bater por suffix8 com cliente "pai" diferente. Mitigação: trigger usa exatamente a mesma cascata do backfill (CPF > suffix8+DDD > suffix8 > email > instagram), e em caso de conflito **cria registro novo em `customers_unified`** (mesma regra dos 63 conflitos de CPF que você aprovou).
- **Performance dos triggers**: upsert por trigger em `chat_contacts` (12k linhas, atualizadas frequentemente) pode adicionar latência. Mitigação: trigger só dispara em INSERT e em UPDATE de campos relevantes (`name`, `profile_pic_url`, `whatsapp`).
- **Realtime do chat**: refatorar `customerStore` como proxy precisa preservar shape exato para não quebrar componentes que fazem destructuring de `DbCustomer`.

## Detalhes técnicos (resumo)

- Helper `public.find_or_create_unified_customer(...)` retorna `uuid` do cliente unificado. SECURITY DEFINER, `SET search_path = public`.
- Trigger genérico `mirror_to_unified()` parametrizado via `TG_ARGV` para reusar entre tabelas.
- Atualização de `phone_e164` no `customers_unified` só ocorre se o campo estiver **vazio** (respeita sua regra: vendedora não deve sobrescrever telefone de cliente identificado por CPF).
- `metadata.sources` é preenchido como array `['pos:uuid', 'chat:uuid', ...]` para auditoria/rollback.
