# Plano: Filtros de período/RFM + múltiplos modelos de template por instância

Quatro mudanças pedidas, agrupadas em 3 frentes.

## 1) Filtros de período de compra + Matriz RFM (construtor de públicos)

**Onde:** `AudienceFilterBuilder.tsx` (aba Online > Automação > Públicos) + RPCs no banco.

Novos filtros, disponíveis tanto em **Incluir** quanto em **Excluir**:

- **Período da última compra** (modos):
  - `Comprou há mais de N dias` (sem compra recente)
  - `Comprou há menos de N dias` (compra recente)
  - `Última compra depois de DD/MM/AAAA`
  - `Última compra antes de DD/MM/AAAA`
  - `Comprou entre data X e data Y`
- **Matriz RFM**: multiseleção dos segmentos existentes (champions, loyal_customers, at_risk, cant_lose, hibernating, lost, new_customers, promising, leads, others), com rótulos amigáveis em PT.

Implementação técnica:
- `AudienceFilterBlock` ganha campos: `last_purchase_op` (`gt_days`|`lt_days`|`after`|`before`|`between`), `last_purchase_days`, `last_purchase_from`, `last_purchase_to`, e `rfm_segments: string[]`.
- `bc_match_audience` (função IMMUTABLE) passa a avaliar `last_purchase_at` e `rfm_segment` nos blocos include/exclude.
- `audience_filter_options` passa a devolver também a lista de `rfm_segments`.
- UI: nova seção "Período de compra" (select de modo + inputs de dias/datas) e multiselect "Matriz RFM" dentro de cada bloco.

## 2) Múltiplos modelos de template por quantidade de cards

Hoje `templates_carrossel` tem PK em `qtd_cards` → só 1 template por contagem. Vamos permitir vários "modelos" (ex.: "Tamanho 34", "Lançamentos"), cada um com sua própria escada de 2–10 cards.

Migração de banco:
- Trocar a PK: adicionar `id uuid default gen_random_uuid()` como PK; adicionar `nome text not null default 'Padrão'` (nome do modelo).
- `whatsapp_number_id` passa a ser obrigatório para novos registros.
- Índice único `(whatsapp_number_id, nome, qtd_cards)`.
- Backfill: registros existentes recebem `nome = 'Padrão'`.
- `resolve_campaign_template` passa a receber/filtrar por `whatsapp_number_id` + `nome` do modelo da campanha.

UI (`CarouselTemplatesLadder.tsx`):
- Campo **Nome do modelo** na criação (ex.: "Tamanho 34").
- Lista de modelos existentes por instância; ao escolher um modelo mostra a escada (2–10) dele.
- "Criar/Recriar" grava com `nome` + `whatsapp_number_id`.
- `carousel-ladder-create` (edge function) passa a receber e gravar `nome`.

## 3) Templates escopados pela instância Meta selecionada

**Onde:** `CarouselTemplatesLadder.tsx`.

- A escada/lista de templates aprovados **só aparece depois** de selecionar a instância Meta no topo. Sem instância selecionada → mensagem "Selecione uma instância Meta para ver/gerenciar os templates".
- `loadRows()` passa a filtrar `templates_carrossel` por `whatsapp_number_id = numberId` (hoje carrega tudo). Assim, ao selecionar "Meta Pérola" só aparecem os templates dessa instância — nunca da Zoppy ou de outra.
- A sincronização de status (`syncStatus`) já usa `numberId`; passa a atualizar apenas as linhas daquela instância + modelo.

## Vínculo público → instância/modelo (necessário para o disparo)

Para o disparo saber qual modelo/instância usar, `campanhas_auto` ganha `whatsapp_number_id` e `template_modelo` (nome). No editor de público (`CampaignAudienceManager.tsx`) adiciono os seletores de **Instância Meta** e **Modelo de template**. `resolve_campaign_template` usa esses campos.

## Detalhes técnicos / arquivos

- Migração SQL: `templates_carrossel` (nova PK, `nome`, índice único, backfill); `campanhas_auto` (+`whatsapp_number_id`, +`template_modelo`); recriar `bc_match_audience`, `audience_filter_options`, `resolve_campaign_template`.
- Front: `AudienceFilterBuilder.tsx`, `MultiSelectFilter.tsx` (reuso), `CampaignAudienceManager.tsx`, `CarouselTemplatesLadder.tsx`.
- Edge function: `carousel-ladder-create` (campo `nome`).
- Sem quebrar legado: filtros antigos sem os novos campos continuam funcionando; templates sem `nome` viram "Padrão".

## Validação
- Contagem de público em tempo real com os novos filtros (período + RFM).
- Criar 2 modelos distintos para a mesma contagem de cards na mesma instância.
- Trocar instância no topo e confirmar que a lista de aprovados muda e nunca mistura instâncias.