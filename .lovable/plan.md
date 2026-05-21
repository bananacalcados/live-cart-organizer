# Unificação de Clientes — Mapa de Migração

## 1. Resposta rápida sobre o "ID humano"

Sim, vale criar um **código sequencial humano** (`customer_code`, ex.: `BC-000001`) **além do `id` UUID interno**:

- `id` (UUID) → chave técnica usada em todas as foreign keys. Indexação rápida, gerada pelo banco.
- `customer_code` (TEXT único, ex.: `BC-000123`) → usado por operadores no PDV/atendimento ("cliente BC-512"), aparece em etiquetas, NF-e, fichas impressas.

Não afeta performance — apenas mais um índice único. Ganha muito em usabilidade.

## 2. Tabelas envolvidas (12 fontes → 1 destino)

| Tabela atual | Linhas | Destino |
|---|---:|---|
| `customers` | 1.390 | merge → `customers_unified` |
| `pos_customers` | 1.507 | merge → `customers_unified` |
| `customer_registrations` | 389 | merge (endereço) → `customers_unified` |
| `chat_contacts` | 12.980 | merge (nome/foto) → `customers_unified` |
| `instagram_user_links` | 710 | merge (instagram) → `customers_unified` |
| `marketing_contacts` | 75.389 | dedupe → `customers_unified` + `customer_list_memberships` |
| `zoppy_customers` | 25.315 | merge (RFM, compras) → `customers_unified` |
| `ravena_customers` | 2.457 | merge (RFM legado) → `customers_unified` |
| `customer_loyalty_points` | 1.193 | manter tabela, trocar `customer_phone` por `customer_id` |
| `customer_prizes` | 8 | manter tabela, trocar `customer_phone` por `customer_id` |
| `email_contacts` | 0 | descartar (vazia) |
| Leads (`lp_leads`, `ad_leads`, `campaign_leads`, `event_leads`, `catalog_lead_registrations`) | ~13.880 | **mantidos como estão** (não viram clientes até converter) |

## 3. Estrutura da `customers_unified`

```text
customers_unified
├── id                    UUID PK
├── customer_code         TEXT UNIQUE  (BC-000001, sequencial)
├── tenant_id             UUID         (multi-tenant)
│
├── IDENTIDADE
│   ├── name              TEXT
│   ├── cpf               TEXT UNIQUE NULL
│   ├── email             TEXT
│   ├── birth_date        DATE
│   ├── gender            TEXT
│   │
├── CONTATO
│   ├── phone_e164        TEXT         (55DDD9XXXXXXXX)
│   ├── phone_suffix8     TEXT  INDEX  (últimos 8 dígitos — match cross-source)
│   ├── previous_phones   TEXT[]
│   ├── instagram_handle  TEXT  INDEX
│   ├── instagram_user_id TEXT
│   │
├── ENDEREÇO
│   ├── cep, address, address_number, complement, neighborhood, city, state
│   │
├── PERFIL COMERCIAL
│   ├── shoe_size, preferred_style, age_range
│   ├── has_children, children_age_range
│   │
├── MÉTRICAS (atualizadas por trigger em `orders` + `pos_sales`)
│   ├── total_orders          INT
│   ├── total_spent           NUMERIC
│   ├── avg_ticket            NUMERIC
│   ├── total_items           INT
│   ├── first_purchase_at     TIMESTAMPTZ
│   ├── last_purchase_at      TIMESTAMPTZ
│   │
├── SEGMENTAÇÃO
│   ├── rfm_segment, rfm_r, rfm_f, rfm_m
│   ├── region_type (GV / Online), ddd
│   ├── tags TEXT[]
│   │
├── STATUS
│   ├── is_banned, ban_reason
│   ├── live_cancellation_count
│   │
└── created_at, updated_at, last_seen_at

customer_list_memberships
├── customer_id  → customers_unified.id
├── list_id      → marketing_lists.id
└── added_at

-- "Últimas compras" / "produtos comprados" NÃO viram colunas.
-- Vêm de JOIN com a tabela `orders` (source of truth).
```

**Chave de deduplicação (cascata):**
1. CPF (limpo) → match 100%
2. `phone_suffix8` + DDD → match forte
3. `phone_suffix8` apenas → match provável
4. email normalizado → match secundário
5. `instagram_handle` normalizado → match auxiliar

## 4. Plano de execução em 6 fases

**Fase 1 — Criar a tabela e índices**
- Criar `customers_unified` + sequence `customer_code_seq`
- Índices: `id`, `customer_code`, `cpf`, `phone_suffix8`, `phone_e164`, `instagram_handle`, `email`, `tenant_id`
- Criar `customer_list_memberships`

**Fase 2 — Backfill (ETL em ordem de "qualidade do dado")**
1. `zoppy_customers` (rico em compras + RFM) → semeia a base
2. `pos_customers` (endereço completo + perfil) → merge por CPF/phone
3. `customer_registrations` (endereço de checkout) → merge por CPF
4. `customers` (instagram + ban) → merge por instagram/phone
5. `instagram_user_links` → completa `instagram_user_id`
6. `ravena_customers` (legado) → merge por phone
7. `chat_contacts` (12k) → cria clientes só se phone novo, senão atualiza nome/foto
8. `marketing_contacts` (75k) → dedupe por phone, criar membership por `list_id`

Roda como edge function paginada (1000/lote) com log de matches/criações/conflitos.

**Fase 3 — Triggers de métricas**
- Trigger em `orders` (e `pos_sales`) que recalcula `total_orders`, `total_spent`, `avg_ticket`, `last_purchase_at` no cliente afetado.

**Fase 4 — Refatorar leitura/escrita do código**
- `customerStore`, `customerFormUtils`, CRM, Broadcasts, Lives, Automações, Checkout, POS → todos passam a ler/escrever em `customers_unified`.
- Tabelas dependentes (`customer_loyalty_points`, `customer_prizes`, `customer_registrations.customer_id`) ganham FK para `customers_unified.id`.

**Fase 5 — Período de observação (7 dias)**
- Tabelas antigas ficam **read-only** (revoke INSERT/UPDATE).
- Logs comparam leituras das novas vs antigas. Qualquer divergência é alertada.

**Fase 6 — Limpeza**
- Drop: `email_contacts` (vazia), `ravena_customers` (legado integrado), `marketing_contacts` (substituída por unified + memberships), `instagram_user_links` (campos absorvidos).
- Mantidas mas reduzidas a "views legadas" durante 30 dias: `pos_customers`, `customers`, `zoppy_customers` (vira VIEW sobre `customers_unified` para compatibilidade temporária).
- Após 30 dias: drop final das views.

## 5. Performance esperada

- ~28.000 clientes únicos estimados após dedupe (vs 120k registros somados hoje).
- Tabela com ~40 colunas + 7 índices: queries em <10ms para qualquer lookup por CPF/phone/instagram.
- Métricas (total_spent etc.) pré-calculadas via trigger evitam agregação ao vivo.
- "Histórico de compras" via JOIN com `orders` — Postgres faz isso instantaneamente com índice em `orders.customer_id`.

## 6. Detalhes técnicos

- Migração feita como **edge function `unify-customers-backfill`** com flag `--dry-run` para gerar relatório antes de gravar.
- Cada cliente unificado guarda em `metadata` jsonb a lista de origens (`{from: ['zoppy:abc', 'pos:xyz']}`) para auditoria/rollback.
- Código humano `BC-000001` formatado via função `format_customer_code(seq)` chamada por trigger BEFORE INSERT.
- RLS por `tenant_id` já no momento da criação.
- Tabelas de leads **não** são tocadas — só ganham coluna opcional `converted_customer_id` para quando virarem cliente.

## 7. O que entrego primeiro

Sigo essa ordem incremental:
1. Migration: cria `customers_unified` + `customer_list_memberships` + sequence + triggers de código.
2. Edge function backfill em modo **dry-run** → relatório (quantos únicos, quantos matches, quantos conflitos) antes de qualquer escrita.
3. Você revisa o relatório → autoriza a execução real.
4. Refactor das telas/stores uma por vez (POS → CRM → Broadcasts → Automações → Lives → Checkout).
5. Fase de read-only + drop final.
