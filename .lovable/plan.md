
# Condicional no PDV (Frente de Caixa > Venda)

## Objetivo
Adicionar a 4ª opção **"Condicional"** ao lado de Presencial / Online / Trocas Site. Um condicional é um pedido enviado à casa do cliente para experimentar; ele decide com quais fica. Duas etapas:

1. **Novo condicional** — seleciona produtos + cliente (dados **obrigatórios**) → gera **comprovante com assinaturas** → **baixa o estoque** (para não vender nos outros canais) → **NÃO entra no faturamento** da loja nem da vendedora → aparece na aba **Pedidos** com tag Condicional.
2. **Finalizar condicional** — puxa um condicional já enviado → remove os itens **devolvidos** (estoque **restaurado**) → cobra os itens que ficaram (forma de pagamento etc.) → **entra no faturamento** da loja e da vendedora → tag **Condicional** permanente na venda.

## Decisão de arquitetura (por que não quebra nada)
Reutilizamos `pos_sales` com um novo `status = 'conditional'` em vez de criar um modelo paralelo. Isso porque a auditoria mostrou que:
- Estoque só é baixado/estornado nos status `completed`/`paid`/`cancelled` (função idempotente `process_pos_sale_sale_event`, que evita baixa dupla por já existirem ajustes `sale_event='sale'`).
- Faturamento (`pos_sale_to_faturamento`) e todos os dashboards **ignoram** qualquer status diferente de `paid`/`completed`.

Logo, um pedido com `status='conditional'`:
- **não** gera lançamento de faturamento (a função já dá `RETURN` fora de paid/completed);
- **não** aparece nas métricas de vendedora/loja (dashboards filtram `status='completed'`);
- mas precisamos **forçar a baixa de estoque** nesse status (hoje o trigger só baixa em completed/paid).

Na finalização, a transição `conditional → completed` faz o trigger rodar `process_pos_sale_sale_event` de novo — **idempotente**, então os itens mantidos NÃO são baixados em dobro; e o faturamento é criado normalmente.

## Banco de dados (1 migration)

**1. Ajustar `process_pos_sale_sale_event`** para também aceitar `status='conditional'` na guarda de entrada (`status IN ('completed','paid','conditional')`). A idempotência por `sale_event='sale'` já protege a etapa 2.

**2. Ajustar `apply_pos_sale_stock_movement`:**
- INSERT com `status='conditional'` → chama `process_pos_sale_sale_event` (baixa todos os itens).
- UPDATE `conditional → completed/paid` → chama `process_pos_sale_sale_event` (idempotente, não rebaixa mantidos).
- (Cancelamento de condicional continua estornando via o ramo `cancelled` já existente.)

**3. Nova função `restore_pos_sale_item_stock(p_sale_id, p_sku, p_barcode)`** (SECURITY DEFINER): para cada item **devolvido** na finalização — soma de volta em `pos_products.stock`, grava ajuste `direction='in', sale_event='return'` (guard anti-duplo estorno) e dispara `shopify-mirror-stock`/`tiny-mirror-stock`. Espelha o padrão do ramo `cancelled`, mas por item.

**4. Novas colunas em `pos_sales`** (nullable, sem impacto no existente):
- `is_conditional boolean default false`
- `conditional_status text` (`draft_sent` | `finalized`) — só para condicionais.
- `conditional_signed_at timestamptz` (opcional, registro de assinatura na entrega).

Faturamento/estoque continuam guiados por `status`. Índice parcial `where is_conditional`. GRANTs já cobertos pela policy `authenticated`/`service_role` existente da tabela.

> Observação: a tabela `pos_conditionals` atual (modelo "loan") **não** é usada aqui — fica intacta.

## Edge function

**`pos-conditional-finalize`** (idempotente, por etapa, com trava):
Entrada: `sale_id` (condicional), `kept_items[]`, `returned_items[]`, `payment_method`, `payment_details`, `discount`, `seller_id`.
1. Trava por status (`is_conditional && conditional_status='draft_sent'`; se já `finalized` → retorna sucesso sem repetir).
2. Para cada `returned_item` → `restore_pos_sale_item_stock` + `DELETE` do `pos_sale_items`.
3. Recalcula `subtotal/discount/total` a partir dos itens mantidos.
4. Atualiza `payment_method`, `payment_details` (com `conditional: true`), `paid_at`, `cash_register_id`, `seller_id`, `conditional_status='finalized'`.
5. Transição `status='conditional' → 'completed'` (trigger fatura + confirma baixa idempotente).
Cada passo grava progresso; se algo falhar depois de restaurar estoque, a venda não se perde e o passo é reexecutável.

## Frontend (`POSSalesView.tsx` + componentes novos)

**1. Modal "Tipo de venda"** → grid de 4 (hoje 3): adicionar botão **📦 Condicional** (cor distinta, ex. verde). Ao clicar abre submodal:
- **Novo condicional**
- **Finalizar condicional**

**2. Fluxo "Novo condicional"** (`saleType='conditional'`, `conditionalStage='new'`):
- Carrinho normal (bipar/adicionar produtos).
- Cliente: seleção/cadastro com **validação obrigatória** de **nome, CPF, telefone, email, CEP e endereço completo** (bloqueia avanço se faltar — reforço no passo de cliente só quando é condicional/novo).
- **Pula pagamento**. Botão final: **"Gerar condicional"** → cria `pos_sales` com `status='conditional'`, `is_conditional=true`, `conditional_status='draft_sent'`, `sale_type='online'` (para herdar aba Envios/endereço), tag nas notes `📦 Condicional`.
- Abre **comprovante imprimível** (novo `src/lib/pos/conditionalReceipt.ts`, no padrão de `providerReceipt.ts`): cabeçalho Banana, dados do cliente/endereço, tabela de produtos com preços e total, **2 campos de assinatura**: "Conferência da vendedora" e "Assinatura da cliente (no recebimento)", data.

**3. Fluxo "Finalizar condicional"** (`ConditionalFinalizePicker.tsx`, paginado, no padrão do `SiteExchangePicker`):
- Lista condicionais `is_conditional && conditional_status='draft_sent'` (mais recentes primeiro, busca por nome/telefone/CPF/nº).
- Ao escolher: carrega itens no carrinho; a vendedora **remove os devolvidos** e mantém os vendidos; pode ajustar quantidade.
- Segue para **pagamento normal**. Botão final chama `pos-conditional-finalize` com kept/returned calculados por diff dos `pos_sale_items` originais x carrinho final.
- Ao concluir: tag **Condicional** permanece; venda passa a contar no faturamento.

**4. Tags e listagens:**
- Badge **📦 Condicional** no header da venda (ao lado de Presencial/Online), como já feito para Troca Site.
- Aba **Pedidos**: incluir condicionais (`is_conditional=true`) com selo Condicional e ação "Finalizar condicional". `POSSaleDetailDialog` mostra o selo e o estado (enviado/finalizado).

## O que pode dar errado (e como prevenimos)
- **Baixa dupla de estoque na finalização** → `process_pos_sale_sale_event` é idempotente por `sale_event='sale'`; itens mantidos não rebaixam.
- **Estorno duplo de item devolvido** (duplo clique/reprocesso) → `restore_pos_sale_item_stock` checa ajuste `sale_event='return'` existente.
- **Condicional entrando no faturamento cedo** → status `conditional` é ignorado por `pos_sale_to_faturamento` e pelos dashboards; só entra ao virar `completed`.
- **Condicional aparecendo nas metas da vendedora** → dashboards filtram `status='completed'`; garantimos que o `seller_id` já esteja gravado para creditar corretamente **só na finalização**.
- **Dois atendentes finalizando o mesmo condicional** → trava por `conditional_status='finalized'` (retorno idempotente).
- **Cliente sem endereço/CPF** → validação obrigatória bloqueia a criação do condicional.
- **NFC-e/NF-e** → **não** emitir fiscal na etapa 1 (não houve venda). Auto-emissão fiscal só na finalização (segue regra atual por `sale_type`). 
- **Cancelar um condicional inteiro** (cliente devolveu tudo / desistiu) → mudar `status='cancelled'` estorna todo o estoque pelo ramo já existente; não fatura.
- **Espelho de estoque Shopify/Tiny** → reutiliza as funções de mirror já usadas na venda/cancelamento (SET absoluto por soma de lojas), sem lógica nova de estoque compartilhado.

## Fora de escopo (confirmar depois)
- Vencimento/lembrete automático de devolução do condicional (due_date + follow-up WhatsApp).
- Emissão fiscal automática na finalização além da regra atual.

## Ordem de execução
1. Migration (colunas + funções + trigger).
2. Edge function `pos-conditional-finalize` (+ deploy).
3. `conditionalReceipt.ts`, `ConditionalFinalizePicker.tsx`.
4. Integração no `POSSalesView.tsx` (botão, submodal, validação, criação, finalização, badges).
5. Selo Condicional em Pedidos e `POSSaleDetailDialog`.
6. Teste com 1 condicional real de ponta a ponta antes de publicar.
