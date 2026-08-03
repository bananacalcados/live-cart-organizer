# Rateio de Live por evento (FOLHA) + espelho no dashboard da loja

## O que acontece hoje

**Aba FOLHA (PDV > Dashboard Geral)**
1. Busca todas as vendas do período (`pos_sales`, status recebido, sem `site_pickup_only`).
2. Vendas com `sale_type = live` e vendedora virtual ("Live Shopping") vão para um **pool por loja**.
3. O pool da loja é dividido **igualmente** entre as pessoas marcadas como participantes de live daquela loja no período.
4. A marcação de participante é por **pessoa + loja + período inteiro** — não existe granularidade por evento/live.

É exatamente esse ponto 4 que gera o problema da Valéria: como ela está marcada como participante da Live do Centro no período, ela recebe cota de **todas** as lives do Centro no período, inclusive a que não participou.

**Dashboard dentro da loja**
Existem hoje **duas fontes diferentes**, e é essa a causa da divergência:

- **Ranking "Vendedoras" (POSDashboard)**: soma bruta de `pos_sales` agrupada por `seller_id`, descontando só o frete. Como as vendas de live ficam na vendedora virtual "Live Shopping", **elas nunca entram no valor de nenhuma vendedora** nessa lista. Não usa `computePayroll`, não usa participantes de live, não usa escala de comissão.
- **Painel "Metas Escalonadas" (POSStoreScaledGoals)**: esse sim já usa `computePayroll`, o mesmo cálculo da FOLHA — porém com **um filtro a mais** (`expedition_stage = 'concluido'`), o que faz o faturamento ficar menor que o da FOLHA para o mesmo período.

Ou seja: o "caminho exato" para espelhar a FOLHA é `computePayroll` (`src/lib/pos/payroll.ts`), alimentado pelas mesmas consultas — o dashboard da loja precisa passar a usá-lo como fonte única e o ranking de vendedoras precisa deixar de somar `pos_sales` por conta própria.

## O que será implementado

### 1. Exclusão de eventos por vendedora (banco)
Nova tabela `pos_commission_live_event_optouts`:
- pessoa, evento (`event_id`), loja, quem alterou, data.
- Regra: **por padrão a vendedora participa de todos os eventos da loja** (comportamento atual preservado); marcar a linha significa "não participou daquele evento".
- Acesso: leitura/gravação para usuários autenticados, igual às demais tabelas de comissionamento.

### 2. Rateio por evento no cálculo
`computePayroll` passa a acumular o pool de live **por loja + evento** (`pos_sales.event_id`), em vez de só por loja:
- Para cada evento, os participantes são: participantes da loja no período **menos** quem tem opt-out naquele evento.
- Cota = faturamento líquido do evento ÷ nº de participantes válidos **daquele evento**.
- Vendas de live sem `event_id` continuam num balde "geral da loja" com a regra atual.
- Cada linha de pessoa passa a expor o detalhamento `liveEvents[]` (evento, nome, data, líquido, participantes, cota, incluído sim/não) para a UI.
- Vendas de live com vendedora real continuam creditadas direto, fora do rateio (sem dupla contagem).

### 3. UI da FOLHA — clique no faturamento de Live
No valor de Live da vendedora (coluna de live e/ou detalhe expandido), clique abre um modal:
- Lista **todos os eventos que incidiram** no faturamento de live daquela vendedora no período.
- Colunas: evento, data, loja, faturamento líquido do evento, nº participantes, cota da vendedora.
- **Checkbox por evento** (marcado = participou). Desmarcar grava o opt-out e recalcula na hora o faturamento, a cota dos demais participantes daquele evento, atingimento e comissão.
- Rodapé com o total de live antes/depois da alteração.

### 4. Espelho no dashboard da loja
- `POSStoreScaledGoals` deixa de aplicar `expedition_stage = 'concluido'`, ficando com **os mesmos filtros da FOLHA** (mesmos status, mesma janela por `paid_at`/`created_at`, mesma exclusão de `site_pickup_only`).
- O ranking de vendedoras do `POSDashboard` passa a ler o resultado de `computePayroll` (total por pessoa da loja, já com live rateada e opt-outs aplicados), em vez de somar `pos_sales` por `seller_id`. Contagem de vendas e itens continuam vindo das vendas diretas.
- O mesmo modal de eventos fica disponível a partir do dashboard da loja (somente leitura ou editável, conforme preferir — por padrão editável, já que a regra é a mesma).

## Detalhes técnicos

- Arquivos: `src/lib/pos/payroll.ts` (novo agrupamento por evento + tipos `LiveEventBreakdown`), `src/components/pos/POSPayrollTab.tsx`, novo `src/components/pos/PayrollLiveEventsDialog.tsx`, `src/components/pos/POSStoreScaledGoals.tsx`, `src/components/pos/POSDashboard.tsx`.
- Nova consulta de eventos (`events`: id, nome, data) apenas para rotular o modal.
- Testes em `src/test/payroll.test.ts`: rateio por evento, opt-out redistribuindo a cota entre os demais, live sem `event_id`, e ausência de regressão nos casos atuais.
- Nada é apagado: sem opt-out, o resultado numérico é idêntico ao de hoje.
