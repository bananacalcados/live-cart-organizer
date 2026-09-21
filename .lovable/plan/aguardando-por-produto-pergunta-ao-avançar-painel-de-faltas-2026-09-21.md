# Aguardando por produto: pergunta ao avançar, painel de faltas e WhatsApp nos Concluídos

Hoje o pedido só sai da Separação quando o sistema acha que está completo — por isso pedido sem nenhum produto separado não ia para Aguardando. Vamos inverter: **quem decide é você, na hora de avançar**.

## 1. Pergunta ao clicar em SEPARADO

Clicando em **SEPARADO** num pedido da Separação abre uma janela:

- **Pedido com vários produtos:** título "POSSUI TODOS OS PRODUTOS?" e a lista dos produtos, cada um com TEMOS / NÃO TEMOS (começa tudo como TEMOS). Há o botão rápido "Tenho todos".
- **Pedido com 1 produto:** título "VOCÊ POSSUI ESSE PRODUTO?" com os botões SIM e NÃO.

O que acontece depois:

| Situação | Para onde vai o pedido |
|---|---|
| Tem todos | Conferência, normal |
| Tem parte | **Conferência**, com a tag grande vermelha **AGUARDANDO PRODUTO PRA FAZER ENVIO** (aviso para não concluir) |
| Não tem nenhum | Fica na aba **Aguardando**, com botão para avançar quando quiser |

Envio unificado continua junto: a pergunta lista os produtos de todos os pedidos do grupo e todos seguem o mesmo destino.

## 2. Aba Aguardando vira o painel de faltas

Passa a ter duas partes:

1. **Produtos aguardados** — lista agrupada por produto (nome, cor/tamanho, código, quantidade total que falta) e, embaixo de cada um, **quais clientes/pedidos dependem dele**, com a etapa em que o pedido está. Cada linha tem o botão **CHEGOU / SEPARADO**, que dá baixa nesse produto nos pedidos; quando o pedido completa, a tag vermelha some sozinha.
2. **Pedidos parados aqui** — os cards dos pedidos que não têm nenhum produto, com o botão de avançar para Conferência.

**Ordem de prioridade** na aba: SEDEX → mototáxi → retirada na loja → Correios/transportadora → depois os mais antigos primeiro.

Também ganha o botão **Grades · Reposição**, com o mesmo relatório da Separação (calculado só sobre os pedidos aguardando), para saber quantos pares comprar.

## 3. WhatsApp na aba Concluídos

Botão **WHATSAPP** nos cards de Concluídos abre o WhatsApp completo do PDV (o mesmo painel, com todas as funções), já na conversa da cliente.

## Parte técnica

- **Banco:** nova coluna `pos_sales.expedition_waiting_products` (boolean, default false). Reaproveita `pos_sale_items.expedition_picked_qty` para marcar o que já foi separado. Nenhuma trigger de estoque/fiscal é tocada.
- **`ExpAdvancePickDialog.tsx`** (novo): a pergunta com a lista de itens; grava `expedition_picked_qty` dos itens marcados, define `expedition_waiting_products` e move o pedido (e o grupo) para `conferencia` ou `aguardando`.
- **`POSExpedition.tsx`:** botão SEPARADO abre o diálogo em vez de avançar direto; tag grande "AGUARDANDO PRODUTO PRA FAZER ENVIO" em qualquer etapa quando `expedition_waiting_products` estiver ligado; botão WHATSAPP nos Concluídos abre `POSTaskWhatsAppDialog`; `SALE_COLS` inclui a nova coluna.
- **`ExpWaitingPanel.tsx`** (novo): painel da aba Aguardando — agrega itens faltantes de todos os pedidos com `expedition_waiting_products` (em `aguardando` e em `conferencia`), ordena por `expeditionWaitingRank`, botão CHEGOU/SEPARADO (atualiza `expedition_picked_qty` e limpa a flag quando o pedido fecha) e embute `ExpGradeReport`.
- **`src/lib/expeditionPriority.ts`:** função `expeditionWaitingRank` (SEDEX, mototáxi, retirada, Correios/transportadora, demais).
- **`POSWhatsApp.tsx`:** prop opcional `initialPhone` para abrir já na conversa da cliente.
- Não mexe em: baixa de estoque, NF-e/NFC-e, conferência/finalização, unificação de pedidos.
