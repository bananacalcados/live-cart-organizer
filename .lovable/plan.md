## Fase A — Completar ferramentas do Agente IA (Telegram)

Edita `supabase/functions/telegram-financial-webhook/index.ts` para adicionar/parametrizar tools:

1. **`get_sales_summary`** — adiciona `store_id` E `store_name` (resolve nome → id via `pos_stores`), e `group_by_store` opcional (retorna breakdown por loja).
2. **`get_sales_by_payment_method`** — novo. Agrupa `pos_sales.payment_method` por período/loja, retorna `{metodo, qtd, total}[]`.
3. **`get_physical_cash_by_store`** — novo. Lê `pos_cash_registers` (caixas abertos) e retorna dinheiro físico em espécie por loja.
4. **`get_accounts_payable`** — novo. Lê `tiny_accounts_payable` com filtros `from`, `to`, `status` (`pendente`/`pago`/`vencido`/`all`), agrupa por dia. Variante implícita "hoje" via período.
5. **`get_inventory_summary`** — novo. Lê `pos_products` (fonte oficial). Retorna por loja: pares (SUM stock), valor total (SUM stock*price), ticket médio (AVG price), e total geral. Aceita `store_id` opcional.

Mantém regras do POS Dashboard já alinhadas.

## Fase B — Fluxo de Caixa categorizado (Módulo Gestão > Financeiro)

### B1. Banco de dados (migração)
- **Seed `financial_categories`** com plano de contas Banana Calçados (hierárquico, calçados+acessórios):
  - Entradas: Vendas Loja Física, Vendas Online, Crediário Recebido, Devoluções de Fornecedor, Outras Receitas.
  - Saídas: 
    - Compras: Calçados, Acessórios, Embalagens.
    - Marketing: Carro de Som, Anúncios Online (Meta/Google), Influencers, Material Gráfico, Eventos.
    - Operacional: Aluguel, Energia, Água, Internet, Telefonia, Limpeza.
    - Pessoal: Salários, Comissões, Benefícios, Pró-labore.
    - Logística: Frete, Combustível, Manutenção Veículo.
    - Impostos e Taxas: Simples Nacional, Taxas Bancárias, Tarifas Maquininha.
    - Financeiro: Empréstimos, Juros, IOF.
    - Outras Despesas.
- **Tabela `cash_flow_entries`** já existe e tem `metadata jsonb` + `description text` — usaremos `description` para o texto livre do usuário (ex: "Pago ao Victor") e `metadata.notes` para histórico se precisar.
- **Nova view `cash_flow_entries_enriched`** (opcional) joinando categoria e loja para listagens.

### B2. UI no Módulo Gestão > Aba Financeiro
Cria `src/components/management/CashFlowCategorized.tsx` (e integra ao `FinanceHub.tsx`):

- **Topo**: seletor de período (mês atual / mês anterior / custom).
- **Plano de Contas (CRUD)**: árvore hierárquica de categorias. Botões: adicionar categoria/subcategoria, editar nome, desativar. Drag-to-reparent opcional (fase futura).
- **Fluxo de Caixa do período**:
  - Tabela agregada por categoria (entradas/saídas) com totais e saldo.
  - **Click numa linha de categoria** → drawer/expansão listando cada lançamento individual (data, valor, descrição/observação do usuário, método pagamento, loja, anexo).
  - Em cada lançamento: botão editar (categoria, descrição, valor, data), excluir, ver anexo.
- **Resumo lateral**: entradas totais, saídas totais, saldo líquido, top 5 categorias de saída.

### B3. Agente IA — captura de descrição livre
No `telegram-financial-process-attachment` (e webhook):
- Quando o usuário envia comprovante **com legenda (caption)** → caption vai pra `cash_flow_entries.description`.
- Quando envia **só a imagem** → após processar e categorizar, o bot responde: "✅ Categorizei em Marketing > Carro de Som — R$ 600. Quer adicionar uma observação? (responda com o texto ou /skip)" e fica aguardando próxima mensagem (estado salvo em `financial_agent_sessions.expected_action = 'awaiting_description:<entry_id>'`). A próxima mensagem de texto vira `description` daquele lançamento.
- Adiciona tools conversacionais:
  - `register_expense({amount, category_id|category_name, description, payment_method?, store_id?, date?})` — cria lançamento manualmente sem anexo.
  - `register_income(...)` análogo.
  - `update_entry_description({entry_id, description})` — para edição posterior por chat.
  - `get_cash_flow_summary({period, by:'category'|'store'})` — agrega entradas confirmadas.

### B4. Categorização automática
- IA do `process-attachment` recebe lista de categorias ativas + descrição do anexo e escolhe `category_id`. Salva `confidence`. Se < 0.7, `status='needs_review'` (já existe).

## Detalhes técnicos relevantes
- Tabelas reutilizadas: `pos_products`, `pos_stores`, `pos_cash_registers`, `tiny_accounts_payable`, `pos_sales`, `cash_flow_entries`, `financial_categories`, `financial_agent_receipts`, `financial_agent_sessions`.
- Sem novas tabelas; só seed de categorias + possível view.
- GRANTs já existentes nas tabelas (não estamos criando novas).
- Edge functions afetadas: `telegram-financial-webhook`, `telegram-financial-process-attachment`.
- Frontend: `src/components/management/FinanceHub.tsx` (adiciona aba/seção), novo `CashFlowCategorized.tsx`, novo `CategoryTreeEditor.tsx`.

## Ordem de execução proposta
1. Migração seed do plano de contas.
2. Fase A (5 tools) — entrega rápida e testável no Telegram.
3. UI do Fluxo de Caixa categorizado + CRUD de categorias.
4. Captura de descrição livre + tools de registro manual no agente.
5. Categorização automática refinada no process-attachment.

Pergunta antes de começar: o plano de contas acima cobre o que você precisa, ou prefere me passar a estrutura exata que usa hoje (ou que gostaria de usar)? Posso começar com esse default e você ajusta depois pelo CRUD.