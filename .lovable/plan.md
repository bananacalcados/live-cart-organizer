## Objetivo

Permitir que o Estrategista (chat em Marketing → Estrategista) crie, sob confirmação em 2 passos:

1. **Eventos/ações no Calendário** de Marketing (visíveis na aba Calendário, não só na tira “ações do agente”).
2. **Públicos de clientes/leads** reutilizáveis, gravados na tabela única `campanha_publicos`, imediatamente selecionáveis em:
   - PDV → Online → Automação (já lê `campanha_publicos`).
   - Marketing → Disparos (hoje não tem público salvo — vamos adicionar seletor).
   - Marketing → Matriz RFM (hoje só salva “presets” em `app_settings` — vamos adicionar botão “Salvar como público”).

Mantendo o padrão existente do agente: `propor_*` → usuário responde “ok” → `commitProposal` grava.

---

## Fonte única de verdade dos públicos

`campanha_publicos.filtro_json` no formato `AudienceFilter = { include, exclude }` já definido em `src/components/pos/audience/AudienceFilterBuilder.tsx`. O RPC `bc_match_audience(cv, inc, exc)` já resolve esse JSON contra `crm_customers_v` (base RFM). Reaproveitar isso evita fragmentar o conceito de público.

Filtros suportados hoje (bloco include e exclude, mesmos campos):
`sizes, cities, ddds, categories, brands, stores, payment_methods, rfm_segments, tags, in_vip_group, min/max_avg_ticket, min/max_total_orders, last_purchase_op+dias/from/to, first_purchase_op+dias/from/to`.

---

## Etapa 0 — Verificações antes de codar (evitar quebrar filtros existentes)

- Localizar e ler `CREATE FUNCTION public.bc_match_audience` nas migrations para confirmar formato exato esperado de `sizes` (string vs int), `ddds`, `tags` e datas. O agente só pode escrever `filtro_json` que esta função entenda 1:1.
- Rodar `list_campaign_audience(p_filtro, 5, 0)` com um `filtro_json` de teste antes de expor a tool, para garantir que preview funciona.

---

## Etapa 1 — Novas tools no `marketing-agent-chat`

Arquivo: `supabase/functions/marketing-agent-chat/index.ts`.

Adicionar em `TOOLS_ANTHROPIC` + `PROPOSAL_TOOLS` + `commitProposal()` (mesmo padrão de `propor_acao_calendario` / `propor_meta`):

### 1.1 Leitura auxiliar (READ_TOOLS, sem confirmação)

- `preview_audience(filtro_json)` → chama `list_campaign_audience(p_filtro, 50, 0)` e devolve `{total_estimado, sample: [nome, telefone, cidade, rfm_segment, purchased_sizes, last_purchase_at]}`. Serve para o agente conferir o que o público retorna antes de propor gravar.
- `list_audiences()` → `select id, nome, filtro_json, updated_at from campanha_publicos order by updated_at desc limit 50`. Para o agente saber o que já existe (e não duplicar).

### 1.2 Escrita — Calendário (2 passos)

- `propor_entrada_calendario` — input: `{entry_date, end_date?, title, content?, entry_type: 'live'|'campanha'|'lembrete'|'meta'|'outro', color?, media_url?, media_type?}`. Commit: `insert into marketing_calendar_entries`.
- `propor_meta_mensal_calendario` — input: `{year, month, goals: string[], actions?, notes?}`. Commit: `upsert into marketing_calendar_goals` por `(year, month)`.

Manter também `propor_acao_calendario` atual (grava em `agent_calendar` como memória do agente) — não remover para não quebrar histórico; instruir no system_prompt que a partir de agora ele prefere `propor_entrada_calendario` para itens que devem aparecer no calendário real, e usa `propor_acao_calendario` apenas quando for uma sugestão em rascunho.

### 1.3 Escrita — Públicos (2 passos)

- `propor_publico` — input:
  ```json
  {
    "nome": "string",
    "filtro_json": { "include": {...}, "exclude": {...} },
    "descricao_curta": "string (o que esse público representa, ex: 'Tamanho 36 em GV inativos 60d')"
  }
  ```
  Commit: `insert into campanha_publicos(nome, filtro_json)`. Antes do insert, validar server-side chamando `list_campaign_audience(filtro_json, 1, 0)` — se der erro, aborta com mensagem clara em vez de gravar lixo.
- `propor_atualizar_publico` — input: `{id, nome?, filtro_json?}`. Commit: `update campanha_publicos`.

Opcional (recomendado, migração mínima): adicionar coluna `created_by_agent boolean default false` e `descricao text` em `campanha_publicos` para rastreabilidade. Não obrigatório para funcionar.

### 1.4 System prompt

Ampliar o prompt do agente para:
- Explicar as 4 novas tools de escrita + as 2 de leitura.
- Regra de ouro: **sempre chamar `preview_audience` antes de `propor_publico`** e mostrar ao usuário o `total_estimado` e amostra.
- Instruir a montar `filtro_json` usando somente as chaves suportadas pelo `AudienceFilterBlock` (listar as chaves no prompt).
- Nunca inventar segmento RFM — usar os que aparecerem em `get_rfm_summary`.

---

## Etapa 2 — UI Marketing → Disparos: seletor + salvar público

Arquivo principal: `src/components/marketing/MassTemplateDispatcher.tsx`.

Sem mexer nos ~20 filtros locais existentes (não quebrar). Adicionar em cima da barra de filtros:

- **Combobox “Público salvo”** que lista `campanha_publicos`. Ao escolher:
  - Chama `list_campaign_audience(filtro_json, big_limit, 0)` para obter os `phones/customer_ids`.
  - Aplica esses IDs como um **filtro adicional final** sobre `filteredCustomers` (interseção). Não substitui os filtros de UI atuais — apenas restringe. Isso preserva 100% do fluxo antigo.
- **Botão “Salvar filtros atuais como público”**: converte o subconjunto compatível dos filtros da UI (rfmFilter, tags, region/DDD/cidade, ticket, orders, janela de compra) para o formato `AudienceFilter{include,exclude}` e abre um pequeno diálogo (nome + confirmar) que insere em `campanha_publicos`.
  - Filtros da UI que não têm equivalente em `AudienceFilterBlock` ficam de fora do público salvo (avisar no diálogo: “os filtros X, Y não serão salvos porque não são suportados no formato de público reutilizável”).
- Não tocar em `app_settings` presets — continuam funcionando em paralelo.

---

## Etapa 3 — UI Marketing → Matriz RFM: “Salvar seleção como público”

Arquivo: `src/pages/Marketing.tsx` (aba Clientes RFM, blocos `1194` / `1480-1730`).

- Botão **“Salvar como público”** ao lado dos presets atuais. Converte os filtros ativos da matriz RFM (segmentos selecionados, região, ticket, orders, janela de última compra) em `AudienceFilter{include,exclude}` e insere em `campanha_publicos` via mesmo diálogo do passo 2.
- Nenhuma alteração nos presets `app_settings` existentes.

---

## Etapa 4 — PDV → Online → Automação

Nenhuma mudança de UI. `CampaignAudienceManager` já lê/escreve `campanha_publicos` — os públicos criados pelo agente aparecerão automaticamente na lista.

---

## Etapa 5 — Riscos e mitigação

- **Formato de `filtro_json` incompatível com `bc_match_audience`** → mitigar com Etapa 0 (ler a função) + validação com `list_campaign_audience` antes de gravar.
- **Agente criar públicos duplicados** → tool `list_audiences` no prompt e regra “verifique antes de propor”.
- **Filtros de Disparos que não existem em `AudienceFilterBlock`** → salvar só o subconjunto compatível e avisar no diálogo; presets `app_settings` continuam disponíveis para o resto.
- **Presets `app_settings` vs `campanha_publicos`** → coexistem; nada é migrado agora.
- **`agent_calendar` vs `marketing_calendar_entries`** → não remover `agent_calendar`; agente passa a preferir a tabela real. Zero regressão visual.

---

## Detalhes técnicos (para o build depois de aprovado)

- Backend: 1 edit em `supabase/functions/marketing-agent-chat/index.ts` (novas tools + branches em `commitProposal`).
- Backend opcional: 1 migration adicionando `created_by_agent boolean`, `descricao text` em `campanha_publicos`.
- Frontend:
  - `MassTemplateDispatcher.tsx`: novo componente `<SavedAudiencePicker/>` e `<SaveAsAudienceButton/>` + helper `uiFiltersToAudienceFilter()`.
  - `Marketing.tsx` (aba RFM): botão “Salvar como público” usando o mesmo helper/diálogo.
  - Novo componente compartilhado `src/components/marketing/SaveAudienceDialog.tsx` reutilizado por Disparos e RFM.
- Nada muda em `CampaignAudienceManager.tsx`, `AudienceFilterBuilder.tsx`, `bc_match_audience`, `select_campaign_batch`, `list_campaign_audience`.

---

## Fora de escopo (fica registrado para depois)

- Migrar presets `app_settings` (`rfm_filter_preset_%`) para `campanha_publicos`.
- Consolidar `agent_calendar` dentro de `marketing_calendar_entries`.
- Filtros de Disparos que não cabem em `AudienceFilterBlock` (ex.: `topN`, `sellerFilter`) — se você quiser incluí-los, criamos depois um bloco extra em `AudienceFilterBlock` com atualização coordenada em `bc_match_audience`.
