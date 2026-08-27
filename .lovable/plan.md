# Crediário: vencimentos, carnê e contas a receber

## O que encontrei na auditoria

- A venda salva o crediário direto em `pos_sales` (colunas `crediario_status`, `crediario_due_date`, `crediario_paid_at`, `crediario_paid_amount`, `crediario_gateway`). Não existe nenhuma tabela de parcelas — o número de parcelas hoje só vira texto no nome da forma de pagamento (ex: "Crediário 4x (R$292.00)"). Por isso não há como dar baixa parcela a parcela.
- Existem 181 vendas de crediário em aberto e apenas 26 com gateway preenchido.
- **Causa do erro do item 5:** a busca em CAIXA → Receber Crediário filtra por `payment_method ilike '%crediario%'` (sem acento), mas o banco grava **"Crediário"** com acento — nenhuma venda casa, por isso o resultado vem sempre vazio. Além disso a consulta encadeia dois filtros `.or()` (o segundo sobrescreve a lógica pretendida), não busca por CPF, e nem seleciona as colunas `customer_name`/`customer_phone` que a lista tenta exibir.

## Etapas

### Etapa 1 — Base de dados das parcelas (sem mudança visual)
- Criar `pos_crediario_installments`: venda, loja, cliente, número da parcela, total de parcelas, valor, data de vencimento, status (pendente/pago/atrasado/cancelado), valor pago, data/forma do pagamento, gateway, e um **código curto único por parcela** (ex: `CR-4F2A-03`) para localizar o pagamento no carnê.
- Grants + RLS no mesmo padrão das outras tabelas do PDV, trigger de `updated_at` e índices por loja/vencimento/status.
- Função de servidor para gerar as parcelas de uma venda de forma idempotente (não duplica se rodar duas vezes).
- Nenhuma tela muda nesta etapa; só a fundação, para as próximas não gerarem bug.

### Etapa 2 — Escolher as datas de vencimento na venda
- Na etapa PAGAMENTO, ao escolher Crediário (avulso e no pagamento misto), abaixo do seletor de parcelas aparece a grade de parcelas com data e valor de cada uma.
- Preenchimento automático: primeira parcela em 30 dias, demais a cada 30 dias; com atalhos para mudar o dia base (ex: todo dia 10) e edição manual data a data.
- Valida soma das parcelas = valor do crediário (a diferença de centavos entra na última).
- Ao finalizar a venda, as parcelas são gravadas junto com a venda; se a gravação das parcelas falhar, a venda avisa em vez de ficar sem carnê.

### Etapa 3 — Corrigir a busca em CAIXA → Receber Crediário
- Trocar o filtro por uma função de servidor que ignora acento e maiúsculas, busca por **nome, telefone, CPF e código da parcela**, e considera tanto vendas antigas (sem parcelas) quanto as novas (com parcelas).
- Lista passa a mostrar cliente, vencimento, parcela (3/6) e saldo devedor; baixa passa a ser **por parcela**, atualizando também o resumo da venda (para não quebrar o que já existe em Clientes → Crediário).
- Pagamento em dinheiro continua entrando como reforço de caixa, como hoje.

### Etapa 4 — Impressão do carnê
- Na tela de venda finalizada, quando houver crediário, aparece o botão **Imprimir carnê de compra**.
- Carnê com uma via por parcela: dados da loja, cliente, número do pedido, parcela X/Y, valor, vencimento e o **código da parcela** para localizar o pagamento. Sem código de barras.
- Também disponível depois, pelo detalhe da venda, para reimpressão.

### Etapa 5 — Contas a Receber (Crediário Próprio)
- Nova aba em CAIXA (ou Gestão, conforme preferir) com as parcelas a receber, filtrando por período de vencimento, loja e gateway.
- Foco em **CREDIÁRIO PRÓPRIO**: totais a receber no mês, vencidas, a vencer nos próximos 7/30 dias, e recebido no período; gateways de terceiros ficam separados, já que o dinheiro não entra na loja.
- Lista detalhada com cliente, parcela, vencimento, valor, dias de atraso, e acesso rápido para dar baixa ou abrir a conversa no WhatsApp.
- Exportação CSV e impressão, no mesmo padrão do relatório de período do caixa.

### Etapa 6 — Migração do histórico e verificação
- Gerar parcelas para as vendas de crediário antigas que ainda estão em aberto (usando o número de parcelas que está no texto da forma de pagamento, com 1x como padrão quando não houver), sem alterar as já quitadas.
- Conferência final: busca no caixa, baixa por parcela, totais de contas a receber batendo com o dashboard, e impressão do carnê.

## Detalhes técnicos

- Tabela nova: `public.pos_crediario_installments` (FK para `pos_sales`), com `GRANT` para `authenticated`/`service_role`, RLS e índice `(store_id, status, due_date)`.
- Código da parcela: derivado do id da venda + número da parcela, único, curto e legível.
- Busca do caixa via RPC `SECURITY DEFINER` com `unaccent`/`lower` — evita o problema atual do acento e permite buscar por CPF, que hoje não é possível no cliente.
- Compatibilidade: as colunas `crediario_*` em `pos_sales` continuam sendo atualizadas como resumo, para não quebrar Clientes → Crediário, dashboards e o modal de pagamentos.
