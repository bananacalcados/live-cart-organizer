# Plano: Plano de Contas inteligente + Contas Bancárias + Refresh otimizado

## 1. Reestruturar Plano de Contas (Vendas)

Você está certo: ter `Vendas PDV` e `Vendas Site` lado a lado com `Vendas Live / Loja Física / Marketplace` confunde a IA. Vou reorganizar em **2 raízes claras por origem do dado**, com **subcategorias por método de pagamento**:

```text
ENTRADAS
└── Vendas
    ├── Vendas PDV (origem: pos_sales)
    │   ├── Dinheiro
    │   ├── PIX
    │   ├── Débito
    │   ├── Crédito à vista
    │   ├── Crédito parcelado
    │   ├── Crediário
    │   └── Outros
    └── Vendas Site (origem: Shopify/Tiny)
        ├── PIX
        ├── Cartão
        ├── Boleto
        └── Outros
```

Removo `Vendas Live`, `Vendas Loja Física`, `Vendas Marketplace`, `Vendas Site` (duplicada). Live continua identificável dentro de Vendas Site (pedidos vindos do checkout transparente) e dentro de Vendas PDV (`channel='live'`).

### Como puxar método de pagamento por origem

- **PDV**: `pos_sales.payment_method` já existe → agregação direta.
- **Site (Shopify)**: hoje o pedido chega só com "Checkout Transparente". Solução:
  1. No envio do pedido pra Shopify (edge function de criação) adicionar `**note_attributes**` com `{ name: "payment_method", value: "pix|card|boleto|..." }` — Shopify suporta nativamente e o valor volta no payload do pedido.
  2. Opcionalmente também adicionar **tags** (`payment:pix`) pra facilitar filtros visuais no admin Shopify.
  3. Ao puxar via Tiny/Shopify webhook, ler `note_attributes` e gravar em coluna `payment_method` no `tiny_synced_orders` (ou similar).
- Isso é o mesmo padrão que você vai replicar no outro projeto do site.

## 2. Confronto da Realidade (Caixa Lógico vs Caixa Real)

Criar conceito de **2 livros paralelos** com conciliação:

- **Livro Operacional** (o que o sistema diz): `cash_flow_entries` com `source IN ('pos_sale','shopify','telegram_receipt','manual')`. É o "esperado".
- **Livro Bancário** (o que de fato entrou/saiu): novas linhas `source='bank_statement'` importadas de OFX/XLSX/CSV pelo agente do Telegram.
- **Match / Divergência**: rotina que compara por valor + data (±2 dias) e classifica:
  - `matched` (bateu) → conciliado.
  - `bank_only` (só no banco, sem venda) → entrada extra, investigar.
  - `book_only` (só no sistema, sem banco) → 🚨 possível **fraude/venda fantasma** ou taxa de cartão pendente.
- UI nova em Gestão > Financeiro > **Conciliação**: 3 colunas (Sistema | Banco | Divergências) com ações pra marcar "taxa de cartão", "venda cancelada", "investigar".

## 3. Contas Bancárias + Transferências

Nova tabela `bank_accounts` (nome, banco, agência, conta, tipo, saldo_inicial, ativo).

Adicionar a `cash_flow_entries`:

- `bank_account_id` (de onde saiu / pra onde entrou)
- `transfer_pair_id` (uuid que liga as 2 pernas de uma transferência interna)
- `is_transfer` (boolean) — transferências **não entram no resultado**, só movem saldo.

Saldo de cada conta = `saldo_inicial + SUM(entradas) - SUM(saídas)` filtrado por `bank_account_id`, ignorando `is_transfer=true` no DRE mas considerando no saldo.

**Novas ferramentas do agente Telegram:**

- `register_transfer(from_account, to_account, amount, date, description)` — cria as 2 pernas atômicas com mesmo `transfer_pair_id`.
- `get_bank_balance(account?)` — saldo atual de uma ou todas as contas.
- Ao receber comprovante, prompt: "Saiu de qual conta? Entrou em qual?" (se o agente não identificar pelo banco/recebedor).

**UI**: nova aba **Contas Bancárias** em Gestão > Financeiro (CRUD + saldo atual + extrato por conta).

## 4. Refresh do Gestão (performance)

Diagnóstico atual: a página tem `setInterval` que dispara reload do estado raiz → causa re-mount e perda da aba.

Correções:

- **Trocar full-refresh por refetch granular**: cada card/tab cuida do seu próprio fetch (já é o padrão, mas o pai está disparando). Remover o interval do componente pai.
- **Aumentar intervalo de 1min → 5min** (configurável).
- **Refetch on focus** (quando volta pra aba) ao invés de interval agressivo.
- Manter `defaultValue` da aba em estado (URL search param `?tab=...`) para que mesmo se houver reload, a aba selecionada persiste.
- **Custo atual**: 1 refresh/min × ~8 queries pesadas × usuários ativos = pode estar custando bem. Com 5min + tab-isolated fetches, queda de ~80%.

## 5. Implementação técnica (ordem)

1. **Migration**: novas tabelas `bank_accounts`, colunas `bank_account_id/transfer_pair_id/is_transfer` em `cash_flow_entries`. Limpar seed antigo do plano de contas e re-seed com nova estrutura.
2. **Edge functions** `telegram-financial-webhook`: novas tools `register_transfer`, `get_bank_balance`, `import_bank_statement` (OFX/XLSX/CSV). Atualizar `categorizeEntry` para usar a nova árvore.
3. **Frontend**:
  - `CategoriesManager` — sem mudança (já é genérico).
  - `BankAccountsManager.tsx` — novo CRUD.
  - `BankReconciliation` — expandir para mostrar livro operacional × bancário.
  - `Management.tsx` — remover interval global, mover para por-componente com `staleTime: 5min`.
4. **Shopify**: ajustar a função que cria pedido para enviar `note_attributes.payment_method`. Documentar pra você replicar no outro projeto.

## Perguntas antes de executar

1. **Métodos de pagamento do PDV** — devo seguir a lista que está em `pos_sales.payment_method` no banco hoje, ou você quer definir uma lista fixa (dinheiro, pix, débito, crédito à vista, crédito parcelado, crediário)? 
2. **Contas bancárias iniciais** — quer cadastrar manualmente depois, ou já me passa nomes (ex: "Itaú PJ", "Bradesco PJ", "Caixa loja Pérola") pra eu fazer seed?
3. **Tempo de refresh** — 5 minutos está bom, ou prefere 10?
4. **Confronto da Realidade** — tudo bem começar **sem importação de OFX** (só XLSX/CSV via agente IA, com o agente extraindo as linhas), e adicionar parser OFX nativo num segundo passo?