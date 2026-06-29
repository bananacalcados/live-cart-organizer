## Objetivo
Ao clicar em **Abrir Evento**, abrir um modal de configuração por etapas (wizard), bonito e intuitivo — somente quando o evento ainda não foi totalmente configurado. Cada etapa configurada antes é pulada; há botão **Voltar** e **Avançar**. Ao final, marca o evento como configurado e entra no painel.

## Etapas do wizard
1. **Frete** — frete fixo (R$) e/ou frete grátis acima de R$ X (os dois podem coexistir).
2. **Template Meta + Mensagem** — reaproveita `MetaTemplateConfigurator` + editor de mensagem inicial.
3. **Parcelamento** — "acima de R$ X, parcelar em até N× sem juros".
4. **Ativar Live** — liga os comentários da Live (RPC já existente).

O modal abre na **primeira etapa ainda não configurada** e permite voltar. Botão final: **Concluir e abrir evento**.

## Como o frete será efetivado no checkout (garantia)
Hoje `checkout-quote-freight` já recebe `event_id` + `total_value` e aplica `default_shipping_cost` **apenas no meio de envio mais barato** (tipo `event_fixed`). Vou estender essa mesma função para:
- Ler também o novo campo `free_shipping_threshold` do evento.
- Regra combinada (frete fixo + grátis acima de X):
  - Se `total_value >= free_shipping_threshold` → zera o **frete do meio de envio mais barato** (vira grátis).
  - Senão, se houver frete fixo → aplica o valor fixo **no meio de envio mais barato** (comportamento atual).
- Desconto/valor aplicado **somente** na transportadora/método de menor custo (ex.: só no PAC, nunca no SEDEX). Isso já é o comportamento atual via `reduce` do mais barato — só adiciono a regra de grátis-acima-de-X.

Assim, ao configurar no modal, os valores são gravados no próprio evento e o checkout (que já manda `event_id`) os aplica automaticamente, sem risco de configurar e não efetivar.

## Como o parcelamento será efetivado no checkout
Hoje o checkout lê config **global** em `app_settings`. Vou fazer `loadInstallmentConfig()` no `TransparentCheckout.tsx`:
- Quando houver `eventId`, buscar os campos do evento.
- Se `total_value >= installment_min_value`, usar `installment_max` como `max_installments` e `interest_free_installments` (sem juros até esse limite).
- Sem config no evento → mantém o comportamento global atual (nada quebra).

## Mudanças de banco (migração)
Adicionar colunas em `events`:
- `setup_completed boolean default false`
- `free_shipping_threshold numeric` (null = desativado)
- `installment_min_value numeric` (null = desativado)
- `installment_max integer` (parcelas máx. sem juros)

`default_shipping_cost` (frete fixo) já existe e será reutilizado.

## Arquivos
- **Migração**: novas colunas em `events`.
- **Novo** `src/components/events/EventSetupWizard.tsx`: modal multi-etapa com navegação, detecção de etapas já configuradas e gravação no evento.
- **`src/pages/Events.tsx`**: `handleOpenEvent` passa a abrir o wizard se `!setup_completed`; ao concluir, navega para `/dashboard`. Etapa de Frete/Parcelamento reutilizam inputs; Template reutiliza `MetaTemplateConfigurator` + `InitialMessageEditor`; Live reutiliza a lógica do `LiveActiveToggleButton`.
- **`supabase/functions/checkout-quote-freight/index.ts`**: regra de frete grátis acima de X (no método mais barato).
- **`src/pages/TransparentCheckout.tsx`**: `loadInstallmentConfig` considera config por evento.
- **`src/types/database.ts`**: novos campos em `DbEvent`.

## Observações
- Nada do fluxo atual de criação/edição de evento é removido — o wizard é uma camada de configuração guiada na abertura.
- Frete fixo + grátis-acima-de-X podem ficar os dois ligados (a regra de grátis tem prioridade quando o total atinge o limite).
