# Trocas Site — Puxar pedido do site e converter em venda da vendedora

## Objetivo
Acabar com a venda duplicada (uma no site + uma no PDV da vendedora) quando a vendedora converte um pedido do site que ficou sem estoque. A vendedora "puxa" o pedido do site, troca o produto, finaliza **uma única venda** (Online, com tag de troca) atribuída a ela, e o sistema **cancela o pedido original em todos os lugares** e **zera o estoque do produto que faltou** em todas as lojas.

## Como funciona hoje (auditoria)

**Fluxo dos modais da aba Venda** (`src/components/pos/POSSalesView.tsx`):
1. Seleção de vendedora — `POSSellerGate` (linha ~1562).
2. Popup de tarefas da vendedora.
3. Modal "Tipo de venda" com **2 opções**: Presencial (NFC-e) e Online (NF-e + Envios) — linhas 1579-1607. Define `saleType` = `'physical' | 'online'`.
4. Fluxo de carrinho → cliente → conferência → pagamento → nota. Finalização chama a edge function `pos-tiny-create-sale` e grava em `pos_sales` / `pos_sale_items` / `pos_customers`. Venda online adiciona `sale_type='online'`, `expedition_status='pending'` e `shipping_address` (linhas 1011-1043).

**Onde o pedido do site vive hoje** (o mesmo pedido aparece em 3 lugares):
- `pos_sales` na "loja do site" (`store_id` = Tiny Shopify), com `external_source='shopify'`, `external_order_id`, `sale_type='online'`, `status='completed'` — criado por `shopify-sync-to-pos` (cron) e `shopify-webhook`.
- `expedition_beta_orders` (`shopify_order_id`, `expedition_status`) — módulo Expedição Beta.
- `orders` (`shopify_order_id`) — kanban de pedidos.

**Peças reutilizáveis já existentes:**
- `shopify-pull-order-customer` — puxa cliente + endereço de um pedido Shopify (falta puxar itens).
- `shopify-cancel-live-order` — cancela pedido na Shopify (padrão de auth admin/manager + update de tabelas de sync).
- `shopify-mirror-stock` — faz SET absoluto do estoque na Shopify por barcode (soma de todas as lojas).
- `pos-tiny-create-sale` — cria a venda no PDV.
- Estoque compartilhado: `pos_products` por barcode é a fonte da verdade; zerar = `stock=0` em todas as lojas (produto vira inativo automaticamente pelo trigger de reativação).

## O que vamos construir

### 1. Terceira opção no modal "Tipo de venda"
Adicionar botão **"Trocas Site"** (🔁) ao lado de Presencial/Online em `POSSalesView.tsx`. Ao clicar, abre o fluxo de troca em vez de ir direto pro carrinho. A venda resultante é sempre `sale_type='online'` com tag de troca.

### 2. Modal "Motivo da troca"
Ao escolher Trocas Site, abre modal com motivos pré-definidos (e campo livre "Outro"):
- Falta de tamanho
- Falta de cor
- Produto esgotado
- Produto com defeito
- Cliente preferiu outro modelo
- Outro (texto livre)

### 3. Modal "Puxar pedido do site" (com paginação)
Lista os pedidos do site do **mais recente para o mais antigo**, com paginação (não carrega tudo). Fonte de dados: os pedidos já sincronizados em `pos_sales` (loja do site, `external_source='shopify'`, ainda não cancelados/não trocados) — leve e rápido, com `range()` por página. Busca por nome/telefone/CPF/nº do pedido. Cada linha mostra nº do pedido, cliente, data, valor e itens resumidos.

### 4. Puxar o pedido para o carrinho
Ao selecionar um pedido:
- Nova edge function `shopify-pull-order-full` (ou estender `shopify-pull-order-customer`) retorna **cliente + endereço + itens** do pedido Shopify.
- Preenche automaticamente: cliente (nome, telefone, CPF, CEP, endereço, cidade, estado) e o carrinho com os itens originais.
- A vendedora pode **remover/trocar** o item que faltou e **adicionar** novos produtos (bipando normalmente). O(s) item(ns) original(is) removido(s) ficam registrados como "produto que faltou" para o zeramento de estoque.
- Segue para pagamento normal (a diferença de valor é cobrada/creditada como em qualquer venda).

### 5. Finalização (a parte crítica — tudo ou nada, à prova de erros)
Ao finalizar, uma nova edge function `pos-site-exchange-finalize` executa em ordem, com idempotência e trava:
1. **Trava**: registra em nova tabela `pos_site_exchanges` (unique em `shopify_order_id`) para impedir que duas vendedoras convertam o mesmo pedido. Se já existir troca concluída → bloqueia.
2. **Cria a venda** no PDV da vendedora via `pos-tiny-create-sale` com `sale_type='online'` e `payment_details` contendo `{ site_exchange: true, exchange_reason, original_shopify_order_id, original_items }`. Tag visível "🔁 Troca Site" nos cards/detalhes.
3. **Cancela o pedido original** em todos os lugares:
   - Shopify: cancela via API (reaproveitando padrão do `shopify-cancel-live-order`).
   - `pos_sales` do site: `status='cancelled'` + nota "Convertido em troca #<nova venda>".
   - `expedition_beta_orders`: `expedition_status='cancelled'`.
   - `orders` (se existir para esse `shopify_order_id`): `stage='cancelled'`.
4. **Zera o estoque do produto que faltou** em todas as lojas: `pos_products.stock=0` por barcode/GTIN dos itens originais removidos + `shopify-mirror-stock` para refletir 0 na Shopify (produto some da oferta). Cria também um registro em `pos_stock_adjustments` para auditoria.
5. **Estoque dos novos itens** vendidos é abatido normalmente pelo trigger de venda existente.

### 6. Tratamento de erros / bordas (garantir que nada quebra)
- **Cada etapa é registrada** em `pos_site_exchanges` com status por etapa (`sale_created`, `shopify_cancelled`, `stock_zeroed`, `completed` / `failed_<etapa>`). Se uma etapa falhar depois da venda criada, a venda **não é perdida** — a tela mostra o que faltou e um botão "Repetir etapas pendentes" (idempotente).
- **Pedido já cancelado na Shopify** (422) → tratado como sucesso (igual ao `shopify-cancel-live-order`).
- **Pedido sem vínculo Shopify** → bloqueia com mensagem clara.
- **NF-e/fiscal do pedido original**: cancelar pedido Shopify **não** cancela nota fiscal. Se o pedido do site já teve NF-e emitida, o sistema **avisa** a vendedora/gestor para cancelamento fiscal manual (não tentamos cancelar NF-e automaticamente).
- **Duplo clique / reprocesso**: idempotência pela trava unique + verificação de status.
- **Caixa fechado**: bloqueia como nas outras vendas.
- **Cliente sem CPF/endereço** no pedido Shopify: usa o que houver; venda online segue exigindo endereço como hoje.

## Alterações técnicas (resumo para o time)

**Banco (migration):**
- Nova tabela `pos_site_exchanges`: `id`, `shopify_order_id` (unique), `shopify_order_name`, `original_pos_sale_id`, `new_pos_sale_id`, `seller_id`, `store_id`, `exchange_reason`, `original_items` (jsonb), `zeroed_barcodes` (text[]), `step_status` (jsonb), `status`, timestamps. RLS + GRANTs para `authenticated`/`service_role`.

**Edge functions:**
- `shopify-list-site-orders` (opcional se optarmos por Shopify direto; por padrão listaremos de `pos_sales`).
- `shopify-pull-order-full` — cliente + endereço + itens de um pedido.
- `pos-site-exchange-finalize` — orquestra venda + cancelamentos + zeramento (idempotente, por etapa).

**Frontend (`POSSalesView.tsx` + novos componentes):**
- 3º botão "Trocas Site" no modal de tipo de venda.
- `SiteExchangeReasonDialog`, `SiteExchangePullOrderDialog` (paginado), integração no carrinho com itens pré-carregados e marcação do item que faltou.
- Tag "🔁 Troca Site" nos detalhes/listagens (`POSSaleDetailDialog`, `POSSalesView`).

## Fora de escopo (a confirmar depois)
- Cancelamento fiscal automático da NF-e do pedido original (fica manual, com aviso).
- Reembolso financeiro do pagamento original do site (a venda do site é cancelada; o acerto financeiro do que o cliente já pagou no site segue o processo atual da loja).
