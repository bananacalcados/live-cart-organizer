
# Plano: Melhorias Completas no PDV

## 1. Programa de Fidelidade Global (Todas as Lojas)

**Problema atual**: Cada loja tem sua propria `loyalty_config` e `loyalty_prize_tiers` separadas (filtradas por `store_id`).

**Solucao**: Criar uma configuracao global (sem `store_id` ou com um `store_id` especial "global"). Quando o sistema buscar a configuracao de fidelidade, ele primeiro verifica se existe uma global e usa essa. Isso garante que todas as lojas compartilham as mesmas regras e premios.

**Alteracoes**:
- Migrar os dados existentes para um unico registro global na `loyalty_config` e `loyalty_prize_tiers` (store_id = NULL)
- Ajustar `POSConfig.tsx`: a secao de fidelidade e tiers nao filtra mais por `store_id`, carrega e salva com `store_id = NULL`
- Ajustar `POSSalesView.tsx`: `loadLoyaltyConfig` busca com `is_null('store_id')` ao inves de filtrar pela loja

---

## 2. Desempenho - POS Lento para Entrar

**Diagnostico**: Ao selecionar a loja, o `POS.tsx` dispara `loadSellers` + `loadPending` (2 queries em paralelo) + monta o `POSDashboard` que dispara mais 4-5 queries pesadas simultaneamente (`loadSalesData`, `loadAlerts`, `POSGoalProgress`). O `POSConfig` dispara **15 queries** ao montar.

**Solucao**:
- Lazy-load do `POSConfig`: so carregar dados quando o usuario navegar pra aba Config (ja e assim no render, mas os dados sao carregados no useEffect ao montar; mudar para carregar sob demanda)
- No Dashboard: paralelizar melhor as queries e adicionar cache local com `useState` para evitar re-fetches desnecessarios
- Reduzir a quantidade de queries iniciais no `POSConfig` movendo os loads para dentro de `useEffect` condicionais (so carrega quando a secao e visivel)

---

## 3. Comissoes por Escalonamento de Meta (Novo Modelo)

**Modelo atual**: Faixas de comissao por intervalo de faturamento absoluto (min_revenue -> max_revenue).

**Novo modelo** (conforme a imagem do usuario):
- O admin define um **valor de meta** (ex: R$ 35.000)
- Configura **faixas por % de atingimento** (ex: 80% = 0.8%, 90% = 0.9%, 100% = 1%, 110% = 1.2%, 120% = 1.5%)
- Se a vendedora atingir 95% da meta, ela recebe a comissao da faixa de 90% (0.9%) sobre o **total vendido**
- Se nao atingir pelo menos 80%, nao ganha comissao nenhuma

**Alteracoes no banco**:
- Reestruturar `pos_seller_commission_tiers` para armazenar: `goal_value` (meta base), `achievement_percent` (80, 90, 100, 110, 120), `commission_percent` (0.8, 0.9, 1, 1.2, 1.5)
- Ou criar nova tabela mais simples, mantendo a anterior

**Alteracoes no frontend**:
- `POSConfig.tsx`: reformular a UI de Faixas de Comissao para o novo formato (meta + faixas por %)
- `POSSellerPrivatePanel.tsx`: recalcular comissao com a nova logica
  - Calcular % de atingimento da meta
  - Encontrar a faixa correspondente (a mais alta que o vendedor alcancou)
  - Comissao = faturamento * commission_percent da faixa
  - Mostrar "Falta R$ X para subir de faixa"

---

## 4. Senha para Aba Config (PIN 1530)

**Solucao**: No `POS.tsx`, quando o usuario clicar na aba "Config", abrir um dialog pedindo PIN. O PIN master sera `1530` (hardcoded ou armazenado no banco). So monta o `POSConfig` apos autenticacao.

**Alteracoes**:
- `POS.tsx`: estado `configAuthenticated`, dialog de PIN antes de mostrar Config

---

## 5. Tarefas de Contato no Dashboard

**Solucao**: Adicionar uma secao no `POSDashboard.tsx` que mostra tarefas pendentes filtradas pela loja atual. As vendedoras podem ver e marcar como concluidas diretamente no dashboard.

**Alteracoes**:
- `POSDashboard.tsx`: nova secao "Tarefas de Contato do Dia" com query a `pos_seller_tasks` filtrada por `store_id` e `status = 'pending'`

---

## 6. Segregacao de Tarefas por Loja (Regras de Atribuicao)

**Regras**:
1. So puxar clientes de lojas fisicas (excluir "Tiny Shopify")
2. Atribuir o cliente a loja onde ele mais comprou (baseado no vendedor que mais vendeu pra ele)
3. Se o cliente mudar o comportamento de compra, a loja muda

**Solucao**: Refatorar `generateRfmTasks` para:
- Buscar apenas clientes de vendas fisicas (excluir store "Tiny Shopify" com id `2bd2c08d-321c-47ee-98a9-e27e936818ab`)
- Cruzar telefone do cliente com `pos_sales` para encontrar qual vendedora/loja mais vendeu pra ele
- Gerar tarefas apenas para a loja correspondente

---

## 7. Estrategias de Contato por Segmento RFM

Cada segmento RFM tera uma estrategia de contato diferente com **instrucoes claras** para a vendedora:

| Segmento | Tipo de Contato | Oferta | Script Resumido |
|---|---|---|---|
| Campeoes | Pos-Venda / Lancamento | Acesso antecipado a novidades | "Oi [nome], temos novidades exclusivas pra voce!" |
| Leais | Lancamento / Convite | Convite para evento exclusivo | "Vem conhecer nossa nova colecao em primeira mao!" |
| Potenciais | Oferta Moderada | R$ 30 off em compras acima de R$ 150 | "Sentimos sua falta! Temos R$ 30 de desconto esperando voce" |
| Em Risco | Oferta Agressiva | R$ 50 off em compras acima de R$ 100 | "Faz tempo que voce nao aparece! R$ 50 de desconto so pra voce" |
| Quase Dormindo | Resgate Urgente | R$ 50 off em compras acima de R$ 100 | "Voce e muito especial pra gente! Desconto exclusivo te esperando" |
| Nao Pode Perder | VIP Resgate | R$ 80 off em compras acima de R$ 150 | "Volta pra gente! Desconto VIP de R$ 80 so pra voce" |
| Hibernando | Reativacao | R$ 50 off em compras acima de R$ 100 | "Oi [nome]! Muito tempo sem te ver. Presente de R$ 50 pra voce" |
| Novos | Boas-vindas / Pos-Venda | Obrigado pela primeira compra | "Que bom ter voce como cliente! Como foi sua experiencia?" |
| Promissores | Cross-sell | R$ 30 off na proxima compra | "Vem conhecer nossos lancamentos! Desconto especial pra voce" |

**Alteracoes**:
- Refatorar `generateRfmTasks` para incluir: tipo de contato, oferta detalhada, script/instrucao, ticket medio do cliente
- Adicionar campos `contact_strategy`, `offer_description`, `avg_ticket` no insert das tarefas
- Mostrar essas informacoes no card da tarefa tanto no Config quanto no Dashboard

---

## 8. Informar Ticket Medio e Rastrear Faturamento Influenciado

**Alteracoes**:
- Na geracao de tarefas, incluir ticket medio do cliente na descricao
- No Dashboard: secao mostrando "Faturamento de Tarefas de Contato" - vendas feitas para clientes que tiveram tarefas de contato concluidas no periodo (cruzamento por telefone)

---

## 9. Deduplicacao de Clientes

**Problema**: Clientes duplicados (ex: Rita de Cassia) por troca de numero de telefone.

**Solucao proposta para o CRM**:
- Criar um detector de duplicatas baseado em similaridade de nome (Levenshtein/trigram)
- Mostrar uma tela no CRM com "Possíveis Duplicados" listando pares de clientes com nome similar
- Permitir ao usuario confirmar a unificacao (merge): manter o registro mais recente, somar historico de compras, atualizar telefone
- Isso sera implementado em etapa separada (nao incluido neste sprint)

---

## 10. Selecao de Vendedoras para Tarefas de Contato

**Solucao**: No dialog de "Gerar por RFM", adicionar multi-select de vendedoras que receberao as tarefas (ao inves de distribuir round-robin entre todas as ativas).

**Alteracoes**:
- `POSConfig.tsx`: adicionar multi-select de vendedoras antes de gerar tarefas
- So distribuir round-robin entre as vendedoras selecionadas

---

## 11. Botao Ativar/Desativar Roleta de Premios

**Situacao atual**: Ja existe um switch "Roleta de Premios (Eventos)" na secao de Fidelidade. Porem esta vinculado a `wheel_enabled` que controla a exibicao da roleta apos a venda.

**Solucao**: Tornar esse toggle mais visivel e explícito, possivelmente movendo-o para um Card independente ou adicionando um botao grande de ON/OFF no topo da secao de Roleta.

---

## Resumo das Alteracoes Tecnicas

### Migracao SQL:
- ALTER TABLE `pos_seller_commission_tiers`: adicionar `goal_value`, `achievement_percent`, remover/adaptar `min_revenue`/`max_revenue`
- Adicionar colunas em `pos_seller_tasks`: `contact_strategy`, `offer_description`, `avg_ticket`

### Arquivos a modificar:
- `src/pages/POS.tsx` - PIN para Config, lazy load
- `src/components/pos/POSConfig.tsx` - comissao escalonada, fidelidade global, selecao de vendedoras para tarefas, roleta toggle, estrategias RFM
- `src/components/pos/POSDashboard.tsx` - tarefas no dashboard, faturamento influenciado
- `src/components/pos/POSSalesView.tsx` - loyalty config global
- `src/components/pos/POSSellerPrivatePanel.tsx` - nova logica de comissao escalonada

### Itens para etapa futura:
- Deduplicacao de clientes no CRM (complexo, requer analise cuidadosa)
- Checkout proprio por loja (discutido no plano anterior)
