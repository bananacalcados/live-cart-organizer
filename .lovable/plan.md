# Plano — Seleção manual de grupo no link VIP + reforço anti-grupo-cheio

## Objetivo
Permitir que, ao criar/editar um link de redirecionamento dentro de uma campanha, você possa **opcionalmente fixar um grupo VIP específico** para onde aquele link sempre manda. Quando nenhum for fixado, o comportamento automático atual (rotação por capacidade) continua igual. De quebra, corrigir as brechas que hoje deixam mandar gente pra grupo cheio.

## Parte 1 — Seleção manual do grupo (funcionalidade pedida)

### 1.1 Banco de dados
- Nova coluna `forced_group_id uuid null` em `group_redirect_links` (FK lógica para `whatsapp_groups.id`).
- `null` = modo automático (atual). Preenchido = link fixo naquele grupo.
- Migration com a coluna; sem novos GRANTs (a tabela já é acessada por service role nas edge functions).

### 1.2 Edge function `group-redirect-link`
- Ao carregar o link, passar a selecionar também `forced_group_id`.
- Em `resolveGroupUrl`: se `forced_group_id` estiver definido, buscar **só aquele grupo** e devolver o invite dele.
- Regra de segurança no modo fixo: se o grupo fixado estiver cheio (`is_full` ou `participant_count >= max_participants`), decidir o comportamento (ver 1.4). Por padrão, **cair no modo automático** para não travar entradas.

### 1.3 UI — aba "Links" do `CampaignDetailPanel.tsx`
- No formulário de criar link e na linha de cada link, adicionar um `Select` "Grupo de destino":
  - Opção `Automático (rotação por capacidade)` — padrão.
  - Lista dos grupos de `campaign.target_groups` com nome + contagem atual (`ex: "Vips GV #3 · 209/1000"`).
- Badge no card do link indicando `🔒 Fixo: <nome>` quando houver `forced_group_id`.
- Atualização do `RedirectLink` interface e das queries de insert/update.

### 1.4 Comportamento quando o grupo fixo enche (decisão de produto)
Duas opções — escolher uma:
- **A) Fallback automático (recomendado):** grupo fixo cheio → volta a rotacionar pelos demais da campanha. Nunca deixa cliente sem grupo.
- **B) Fixo estrito:** mantém sempre o grupo escolhido, mesmo cheio (útil p/ grupo exclusivo/segmentado). Mostra aviso na UI de que pode recusar entradas.
Sugestão: implementar **A** como padrão, com um checkbox opcional "manter mesmo cheio" para habilitar B por link.

## Parte 2 — Reforço anti-grupo-cheio (corrige os riscos achados)

### 2.1 Cron multi-provedor (`cron-check-vip-groups`)
- Hoje só refresca via Z‑API. Ajustar para, conforme o `provider` da instância, chamar:
  - uazapi → metadata/participantes uazapi
  - wasender → metadata wasender
  - z-api → endpoint atual
- Assim grupos uazapi/wasender param de ficar com contagem congelada.

### 2.2 Atualizar contagem em tempo real via webhook
- Em `_shared/group-member-tracking.ts`, ao registrar entrada/saída de membro, também **incrementar/decrementar `participant_count`** e recalcular `is_full` na `whatsapp_groups`.
- Elimina a janela de defasagem de até 5 min entre ciclos do cron.

### 2.3 Margem de segurança na capacidade
- No `group-redirect-link`, tratar como "cheio" quando `participant_count >= max_participants - MARGEM` (ex.: MARGEM = 10). Evita estourar 1000 em picos dentro da janela de cache.
- Opcional: reduzir o cache (`CACHE_TTL_MS`) de 2 min para ~30s nos grupos que estão perto do limite.

## Arquivos afetados
- `supabase/migrations/*` (nova coluna `forced_group_id`).
- `supabase/functions/group-redirect-link/index.ts` (modo fixo + margem de segurança).
- `supabase/functions/cron-check-vip-groups/index.ts` (refresh multi-provedor).
- `supabase/functions/_shared/group-member-tracking.ts` (contagem em tempo real).
- `src/components/marketing/CampaignDetailPanel.tsx` (UI de seleção + interface + queries).

## Fora de escopo
- Não altera a estratégia de "encher um grupo antes do próximo" no modo automático.
- Não mexe na criação automática de grupos (`auto-create-vip-group`), só é acionada como fallback.

## Decisões que preciso confirmar antes de executar
1. Comportamento do grupo fixo cheio: **A (fallback)**, **B (estrito)** ou os dois via checkbox?
2. Fazer também a Parte 2 (segurança) junto, ou só a Parte 1 (seleção manual) agora?
3. Valor da margem de segurança (sugiro 10 vagas).
