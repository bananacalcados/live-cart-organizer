
## Plano: Dashboard do POS

Criar uma nova aba "Dashboard" como primeira aba do modulo POS, exibindo metricas de vendas, desempenho por vendedor e alertas operacionais.

---

### Estrutura da Tela

O dashboard sera dividido em 3 secoes principais:

**1. Metricas de Vendas (topo)**
- Cards KPI com seletores de periodo (Hoje / Semana / Mes):
  - Faturamento total
  - Quantidade de vendas
  - Ticket medio
  - Itens por venda (media)

**2. Desempenho por Vendedor (meio)**
- Tabela/lista com cada vendedor mostrando:
  - Total vendido (R$)
  - Quantidade de vendas
  - Ticket medio
  - Media de itens por venda
- Dados tambem filtrados pelo periodo selecionado (dia/semana/mes)

**3. Alertas Operacionais (rodape)**
- WhatsApp aguardando resposta (usa RPC `get_conversation_counts` ja existente)
- Tickets de suporte abertos (tabela `support_tickets` com status `new` ou `in_progress`)
- Solicitacoes inter-loja pendentes (tabelas `pos_inter_store_requests` e `expedition_stock_requests` com status `pending`)

---

### Mudancas Tecnicas

**Novo arquivo: `src/components/pos/POSDashboard.tsx`**
- Componente que recebe `storeId` como prop
- Busca dados de `pos_sales` (com join em `pos_sale_items` para contar itens) e `pos_sellers`
- Calcula metricas para 3 periodos: hoje, ultimos 7 dias, ultimo mes (30 dias)
- Um seletor de periodo (toggle com 3 botoes: Dia / Semana / Mes) controla todos os KPIs
- Secao de alertas busca contagens via:
  - `supabase.rpc('get_conversation_counts')` para WhatsApp
  - `supabase.from('support_tickets').select(count).in('status', ['new','in_progress'])`
  - `supabase.from('pos_inter_store_requests').select(count).eq('to_store_id', storeId).eq('status','pending')`
  - `supabase.from('expedition_stock_requests').select(count).eq('to_store_id', storeId).eq('status','pending')`
- Alertas serao clicaveis, navegando para a aba correspondente

**Arquivo editado: `src/pages/POS.tsx`**
- Adicionar `"dashboard"` como primeiro item no tipo `POSSection`
- Adicionar entrada no array `SECTIONS` com `{ id: "dashboard", label: "Dashboard", icon: BarChart3, priority: true }`
- Alterar estado inicial de `section` de `"sales"` para `"dashboard"`
- Renderizar `<POSDashboard storeId={selectedStore} onNavigateToSection={setSection} />` quando `section === "dashboard"`
- Importar o novo componente

### Visual

- Usa o mesmo tema escuro do POS (`bg-pos-black`, `text-pos-white`, `text-pos-orange`)
- Cards KPI no estilo ja usado em `POSDailySales` (icones coloridos, fundo semi-transparente)
- Alertas com badges vermelhos piscantes para itens pendentes
- Layout responsivo: 2 colunas em mobile, 4 em desktop para KPIs
