

# Sistema de Consolidação de Gastos: Meta Ads + Disparos

## Resumo

Criar um painel de gastos no módulo de Gestão que consolide:
1. **Meta Ads** — gastos reais puxados via Graph API (múltiplas contas)
2. **Disparos de mensagem** — custo estimado calculado a partir dos dados de `dispatch_history` + `dispatch_recipients` que já existem

---

## 1. Meta Ads — Sync de Gastos

### Banco de Dados (migração)

**Tabela `meta_ad_accounts`:**
- `id` uuid PK
- `account_id` text (ex: `act_123456`) — UNIQUE
- `account_name` text
- `is_active` boolean default true
- `created_at` timestamptz

**Tabela `meta_ad_spend_daily`:**
- `id` uuid PK
- `account_id` text FK -> meta_ad_accounts.account_id
- `date` date
- `spend` numeric (valor em BRL)
- `impressions` integer
- `clicks` integer
- `cpm` numeric
- `cpc` numeric
- UNIQUE(account_id, date)

### Edge Function `meta-ads-sync-spend`

- Recebe `{ date_from, date_to }` (ou default últimos 30 dias)
- Percorre todas as contas ativas de `meta_ad_accounts`
- Chama `GET /{account_id}/insights?fields=spend,impressions,clicks,cpm,cpc&time_increment=1&time_range=...`
- Faz upsert no `meta_ad_spend_daily`
- Usa o token `META_ADS_ACCESS_TOKEN` (secret novo a ser adicionado — diferente do `META_WHATSAPP_ACCESS_TOKEN` existente)

### Secret necessário

- `META_ADS_ACCESS_TOKEN` — System User token do Business Manager com permissão `ads_read` cobrindo todas as contas de anúncio

---

## 2. Gastos com Disparos de Mensagem

Não precisa de API externa. Os dados já existem:

- `dispatch_history` tem `sent_count`, `template_name`, `started_at`
- Cada mensagem de template da Meta custa ~R$0,25-0,80 dependendo da categoria (utility/marketing/authentication)

### Abordagem

Adicionar à tabela `dispatch_history`:
- `cost_per_message` numeric (default null) — custo unitário configurável
- `total_cost` numeric (generated/calculado: `sent_count * cost_per_message`)

No frontend, o usuário configura o custo por mensagem (ou usamos um default de R$0,50 para marketing templates). O sistema calcula automaticamente o gasto total por disparo.

Alternativa mais simples: **sem alterar tabela**, calcular no frontend usando `sent_count * custo_configuravel` (armazenado em `app_settings`).

---

## 3. Frontend — Painel de Gastos

Nova aba **"Investimentos"** no módulo de Gestão (`Management.tsx`):

- **Filtro de período** (7d, 30d, mês, custom)
- **KPIs no topo:**
  - Total Ads (soma de spend do período)
  - Total Disparos (soma de mensagens × custo unitário)
  - Investimento Total (ads + disparos)
- **Gráfico de barras** — gastos diários (ads vs disparos empilhados)
- **Breakdown por conta de anúncio** — tabela com spend, impressions, clicks, CPC, CPM por conta
- **Breakdown de disparos** — tabela com cada dispatch, template usado, quantidade enviada, custo estimado
- **Cadastro de contas Meta** — dialog para adicionar/remover account_ids
- **Config de custo por mensagem** — campo para definir custo unitário do template

### Botão "Sincronizar Ads"
Chama a Edge Function `meta-ads-sync-spend` para atualizar os dados do período selecionado.

---

## Resumo de Arquivos

| Arquivo | Ação |
|---|---|
| Migração SQL | `meta_ad_accounts`, `meta_ad_spend_daily` com RLS |
| `supabase/functions/meta-ads-sync-spend/index.ts` | Nova Edge Function |
| `supabase/config.toml` | Adicionar `verify_jwt = false` para a nova function |
| `src/pages/Management.tsx` | Nova aba "Investimentos" |
| Secret `META_ADS_ACCESS_TOKEN` | Será solicitado ao usuário |

---

## Pré-requisito

Você precisará gerar um **System User Token** no Meta Business Manager com permissão `ads_read` para todas as contas de anúncio. Eu solicitarei esse token durante a implementação.

