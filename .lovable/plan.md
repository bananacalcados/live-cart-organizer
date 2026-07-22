# Redirecionador de Link para Live do Instagram

## Onde cada coisa vai ficar

### 1) Painel principal do módulo Eventos (nível global — vale pra todos os eventos)
Nova aba **"Redirecionadores de Live"** dentro de `EventsDashboard` (mesmo nível de "Eventos", "Follow-ups", etc.).

Conteúdo:
- **Lista de redirecionadores** criados (cada um com nome livre, ex.: "Disparo VIP 18h", "Stories orgânico", "Grupos frios").
- Botão **"Criar redirecionador"** → abre modal pedindo apenas: `nome` + `slug` (auto-gerado, editável). O link público fica `checkout.bananacalcados.com.br/live/{slug}` e **nunca muda**.
- Cada linha mostra: nome, slug copiável, total de cliques, últimos 7 dias, status (ativo/pausado), ações (editar nome, pausar, excluir).
- Ao clicar num redirecionador → abre **Dashboard do link** com:
  - Cliques totais / únicos por telefone
  - Filtro por **data** (range picker)
  - Filtro por **evento** (quais eventos estavam ativos com esse link no período)
  - Filtro por **origem** (`utm_source` — qual disparo)
  - Cruzamento com `live_viewers` e `pos_sales` do período → taxa estimada de entrada na live e conversão em venda
  - Timeline de cliques por hora (pra ver cauda longa)

O destino do redirect é **sempre lido do evento atualmente marcado como "AO VIVO"** (ver item 2). Ou seja: o redirecionador é o link estável; o evento ao vivo é quem define pra onde ele aponta naquele momento.

### 2) Dentro de cada Evento — campo do link do Instagram
Novo campo no `EventSetupWizard` (modal "Configurar Live") **e** um card rápido no topo do painel do evento (`Index.tsx`, ao lado do toggle de automação):

- **"Link do Instagram Live"** — input pra colar a URL extraída do IG.
- Validação leve (precisa parecer URL do instagram.com).
- Botão **"Testar link"** (abre em nova aba).
- Toggle **"Esta live está AO VIVO agora"** — quando ligado, esse evento passa a ser o alvo dos redirecionadores. Apenas 1 evento pode estar "ao vivo" por vez (ao ligar num, desliga nos outros).
- Quando nenhum evento estiver marcado como ao vivo, o redirecionador cai na página "Não estamos ao vivo" (Fase 3).

Campos novos em `events`: `instagram_live_url text`, `is_live_broadcasting bool default false`.

## Fases de implementação

**Fase 1 — MVP (esta rodada)**
- Migração: tabela `live_redirect_links` (id, name, slug único, is_active, click_count, created_at); colunas `instagram_live_url` e `is_live_broadcasting` em `events`.
- Edge function `live-redirect` (pública): lê slug → busca evento com `is_live_broadcasting=true` → devolve 302 pro `instagram_live_url` (com deep-link `intent://` no Android e `instagram://` no iOS, fallback pra `https://instagram.com/...`). Se nenhum evento ativo, devolve HTML simples "em breve".
- Rota pública `/live/:slug` no app que chama a edge function.
- UI: aba "Redirecionadores de Live" no `EventsDashboard` com CRUD + contador simples.
- UI: campo do link IG + toggle "AO VIVO" no `EventSetupWizard` e card no topo do painel do evento.
- Log de cliques em nova tabela `live_redirect_clicks` (redirect_id, event_id no momento, phone se veio `?lead=`, utm_source, user_agent, created_at).

**Fase 2 — Dashboard rico**
- Página de detalhes do redirecionador com filtros (data, evento, utm) e cruzamentos com `live_viewers` / `pos_sales`.

**Fase 3 — Página "Não estamos ao vivo"**
- HTML dedicado com captura de telefone (grava em `lp_leads` origem `live_notify`) e botão "Me avisar por WhatsApp".

**Fase 4 (opcional) — Push via OneSignal**
Só depois das fases 1–3 validadas.

## Detalhes técnicos

- Redirect com `Cache-Control: no-store` mas cache em memória do edge de 15s.
- Slug validado (`^[a-z0-9-]+$`), único.
- `live_redirect_clicks` com índice em `(redirect_id, created_at)` pra o dashboard rodar rápido.
- Sem chamada a API do IG (não expõe presença) — cruzamento é sempre com nossas próprias tabelas.
- RLS: `live_redirect_links` e `live_redirect_clicks` `authenticated` full; edge function usa service role pra insert de clique.

## Fora de escopo

- Detecção automática de "live caiu" (Fase 5 futura).
- Push notifications (Fase 4, decidir depois).
- Alterar `group-redirect-link` existente (usaremos como referência, mas o novo é independente).

Se aprovar, começo pela Fase 1 completa (migração + edge function + rota + as duas UIs) num único turno.
