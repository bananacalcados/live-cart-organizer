# Plano — Dashboard de Eventos + Aba FOLHA (Comissionamento)

## Parte 1 — Dashboard de EVENTOS (novos filtros)
Arquivo: `src/components/events/EventsDashboard.tsx`

Hoje os eventos já têm o campo `channel` (`site` | `pos_perola` | `pos_centro`), então dá pra filtrar por loja sem alterar dados.

1. **Filtro "Faturamento por loja"**: nova barra de botões `Todas · Site · Loja Pérola · Loja Centro`. Ao selecionar, filtra os eventos carregados por `channel` antes de buscar os pedidos. Não altera o gráfico "Faturamento por Live" (que continua por evento) — só reduz o conjunto.
2. **Card "Recebido (sem frete)"**: novo KPI. Hoje o `receivedValue` soma só produtos (subtotal − desconto), mas vou tornar explícito subtraindo `shipping_cost` quando estiver embutido, e adicionar `shipping_cost`/`free_shipping` ao `select` de `orders`. Adiciono também um card "Frete recebido" para transparência.

Nada de backend muda nesta parte.

## Parte 2 — Aba FOLHA no Dashboard Geral do PDV
Local: `src/components/pos/POSGeneralDashboard.tsx` (o "Dashboard Geral — Todas as Lojas", que já concentra metas e lojas).

### 2.1 Estrutura de abas + senha
- Adiciono uma barra de abas no topo: **Visão Geral** (conteúdo atual, intacto) e **Folha**.
- **Folha** abre um gate de senha (`joey102030`), no mesmo padrão do PIN de Config (estado em memória da sessão, sem persistir senha). Sem a senha, o conteúdo não monta.
- Novo componente: `src/components/pos/POSPayrollTab.tsx`. Recebe o `periodRange`, lojas e metas já carregados pelo dashboard (reuso, sem duplicar queries onde possível).

### 2.2 O problema da identidade da vendedora
Hoje os registros em `pos_sellers` são fragmentados por canal/loja (ex.: "Viviane físico", "Viviane Oline", "Vitória Online", "Jéssica Fisico", "Jessica Online"), e as lives caem numa vendedora virtual "Live Shopping". Para comissionar por pessoa e detectar venda em mais de uma loja, preciso de um mapeamento canônico explícito (nomes não batem sozinhos).

**Novas tabelas (migração):**
- `pos_commission_people`: pessoa canônica — `name`, `is_active`, `receives_all_lives` (bool, para a híbrida Jéssica).
- `pos_commission_people_sellers`: liga cada `pos_sellers.id` a uma pessoa (`seller_id` único). Configurável na própria aba.
- `pos_commission_live_participants`: quem divide o recebido das lives, por `store_id` + `period_start`/`period_end` (seleção mensal e por loja).
- `pos_commission_scale`: escala editável de comissionamento (`achievement_percent`, `commission_percent`), semeada com: 80→0,5% · 90→0,7% · 100→1% · 110→1,2% · 120→1,5%.

Todas com `GRANT` para `authenticated`/`service_role`, RLS habilitada e políticas para usuários autenticados (dado interno de gestão). `updated_at` com trigger.

### 2.3 Cálculo do faturamento por vendedora (aba Folha)
Para o período selecionado, busco `pos_sales` pagas (`status` in completed/paid/pending_sync, mesma regra do dashboard) das lojas reais (Pérola/Centro) e:

1. **Valor por venda = recebido sem frete** = `total − frete` (frete de `shipping_cost` ou `payment_details.shipping_amount`).
2. **Classificação por canal** de cada venda: `sale_type` (physical/online/live) × loja (Pérola/Centro) → buckets: **Física Pérola, Física Centro, Online Pérola, Online Centro, Live Pérola, Live Centro**.
3. **Agrupamento por pessoa canônica** via o mapeamento da 2.2. Detecta e discrimina quando a mesma pessoa vendeu em mais de uma loja (mostra os valores separados por loja/canal).

### 2.4 Divisão do recebido das lives
- Para cada loja, somo o **recebido (sem frete) das vendas de live** daquela loja.
- Divido igualmente pelo nº de participantes selecionados em `pos_commission_live_participants` (a gestora escolhe quais vendedoras entram, por loja/mês — não precisa ser todas).
- A cota entra no faturamento de cada participante no bucket **Live Pérola/Centro** (ex.: 17.000 ÷ 3 = 5.666,66 para cada uma das 3).

### 2.5 Vendedora híbrida (Jéssica)
- Pessoas com `receives_all_lives = true` recebem o **total de TODAS as lives** (Pérola + Centro, recebido sem frete) somado ao faturamento delas, num bucket "Todas as Lives".
- É uma flag por pessoa (uma ou mais), independente da divisão da 2.4.

### 2.6 Meta e comissão
- Puxo a meta individual do período em `pos_goals` (`goal_type='seller_revenue'`, `seller_id`), casada por qualquer `seller_id` mapeado à pessoa; se a pessoa tiver várias lojas, somo as metas das lojas onde ela atua (configurável). Fallback: se não houver meta individual, mostro alerta "sem meta definida" e não calcula %.
- **Atingimento** = faturamento total da pessoa (loja física + online + lives aplicáveis) ÷ meta.
- **% de comissão** pela escala (2.5): aplico o degrau atingido (ex.: 96% → usa 90%; 100% → 1%; ≥120% → 1,5%; <80% → 0%). Escala editável.
- **Comissão (R$)** = faturamento × %.

### 2.7 UI da aba Folha
- Reusa o seletor de período do dashboard.
- Tabela por vendedora: nome, colunas por canal (Física Pérola/Centro, Online Pérola/Centro, Live Pérola/Centro, cota de live, total lives se híbrida), **Faturamento total**, **Meta**, **% atingido**, **% comissão**, **Comissão R$**.
- Painéis de configuração (dentro da aba): mapear registros `pos_sellers` → pessoa; marcar híbridas; selecionar participantes da divisão de live por loja/mês; editar a escala.
- Botão exportar CSV do fechamento.

## Notas técnicas
- Nada existente é removido: a "Visão Geral" atual continua igual; a Folha é aditiva.
- `pos_seller_commission_tiers`/`pos_seller_commissions` (hoje dormentes no front) ficam intactas; uso tabelas novas dedicadas para não colidir com semânticas antigas.
- Após a migração, o `types.ts` é regenerado e só então escrevo o código que lê as novas tabelas.
- Regenerar tipos exige aprovar a migração primeiro; implemento o front na sequência.

## Pontos que preciso confirmar com você
1. **Meta da pessoa com 2 lojas**: somar as metas das lojas onde ela atua, ou definir uma meta única por pessoa na Folha?
2. **Base do atingimento**: incluir a cota/total de lives no faturamento que conta para bater a meta, ou a meta é só sobre venda física+online?
3. **Frete**: confirmo usar `total − shipping_cost` (com fallback em `payment_details.shipping_amount`) como "recebido sem frete" em todo o cálculo?