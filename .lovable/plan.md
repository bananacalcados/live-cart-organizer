# Base de Órfãos de Grupos VIP — Captura, Disparo e ROAS

## Contexto / problema descoberto
- O typebot da Live grava leads em **`event_leads`** (não em `lp_leads`). O cruzamento antigo ignorava essa tabela, gerando "órfãos" falsos.
- Hoje não existe um lugar único e confiável que responda: "quantos membros tem cada grupo VIP" e "quem entrou no grupo mas não é cliente nem lead".
- Precisamos preservar esses contatos (nome + telefone + grupo) e poder disparar para eles depois, medindo se o disparo gera venda (ROAS).

## Objetivos
1. Saber exatamente quantos membros há em cada grupo VIP, classificados (cliente / lead / órfão).
2. Nunca perder contato de quem entrou no grupo sem se cadastrar.
3. Disparar em massa via WhatsApp API para a base de órfãos.
4. Medir vendas geradas por esses disparos (ROAS).

---

## 1. Classificação correta (fim dos falsos órfãos)
Padronizar o cruzamento para bater contra TODAS as bases de contato por telefone (últimos 8 dígitos):
`customers_unified`, `event_leads`, `lp_leads`, `ad_leads`, `link_page_leads`.

Criar função SQL `classify_group_member(phone)` → retorna `customer` | `lead` | `orphan`, reutilizada em toda a lógica.

## 2. Nova tabela: base de órfãos (persistente)
`vip_orphan_contacts` — um registro por pessoa única (telefone E.164), nunca some mesmo que a lista do grupo mude:
- `phone` (único), `phone_suffix8`, `display_name`
- `group_ids text[]`, `group_names text[]` (todos os grupos VIP onde apareceu)
- `first_seen_at`, `last_seen_at`
- `status`: `orphan` | `promoted` (virou cliente/lead depois) | `opted_out`
- `opted_out` bool (respeita bloqueios / descadastro)
- `metadata jsonb`
- timestamps + GRANTs + RLS + trigger updated_at.

## 3. Função de atualização + contagem por grupo
- `refresh_vip_orphans()`: recomputa a partir de `whatsapp_group_members` vs. todas as bases; faz UPSERT na `vip_orphan_contacts`, marca como `promoted` quem virou cliente/lead, acumula grupos. Idempotente.
- View `vip_group_membership_stats`: por grupo → total, clientes, leads, órfãos, % (fonte única para o painel).
- Acionada por botão "Atualizar base" no painel e opcionalmente por cron diário.

## 4. Disparo em massa (WhatsApp API)
Reutiliza a infra e regras anti-ban já existentes (throttling, cooldown, claim atômico — ver memórias de dispatch).
- `mass_dispatch_campaigns`: nome, mensagem/template, filtros de público (grupo, tem nome, não opt-out), status, contadores, janela de atribuição (dias), criado_em.
- `mass_dispatch_targets`: campanha × contato, status (`pending`/`sent`/`failed`), `sent_at`, `message_id`, telefone.
- Edge function `vip-orphan-dispatch`: processa em lote, roteia pelo provider real (uazapi/wasender) respeitando instância, delays humanos e supressão de contatos bloqueados. Grava opt-out quando o contato pede saída.

## 5. Análise de ROAS
- View `mass_dispatch_roas`: junta `mass_dispatch_targets` → vendas (`pos_sales` / `orders`) pelo sufixo de 8 dígitos, dentro da janela de atribuição da campanha.
- Métricas por campanha: enviados, entregues, compradores atribuídos, receita, ticket médio, taxa de conversão. (Custo de mídia = 0; ROAS = receita atribuída; opcional campo de custo manual.)

## 6. UI — nova sub-aba em Marketing → Grupos VIP
- **Dashboard de Membros**: contagem por grupo (cliente/lead/órfão) usando `vip_group_membership_stats`; botão "Atualizar base".
- **Base de Órfãos**: lista (nome, telefone, grupos), busca/filtros, exportar Excel/CSV, status opt-out.
- **Disparos**: criar campanha (mensagem/template + público), disparar, acompanhar progresso.
- **ROAS**: painel por campanha (enviados → compradores → receita).

---

## Detalhes técnicos
- Chave de identidade: telefone E.164 com 9º dígito (padrão do projeto); match por DDD + 8 últimos dígitos.
- Toda tabela nova em `public`: `CREATE TABLE` → `GRANT` (`authenticated` + `service_role`) → `ENABLE RLS` → policies → trigger `updated_at`.
- Órfão que vira cliente/lead é marcado `promoted` e excluído automaticamente dos disparos.
- Respeitar `blocked_contacts` e opt-out em todo disparo.
- Sem dependência do Tiny; base 100% local.

## Fora de escopo (por ora)
- Fluxos de automação/nurture multi-etapa (só disparo único inicialmente).
- Cobrança/custo de mídia detalhado no ROAS (campo manual opcional).

## Ordem de implementação
1. Função `classify_group_member` + view `vip_group_membership_stats`.
2. Tabela `vip_orphan_contacts` + `refresh_vip_orphans()`.
3. UI Dashboard de Membros + Base de Órfãos (leitura + export).
4. Tabelas de campanha + edge function de disparo.
5. View + painel de ROAS.
