# Link público do catálogo da live para Grupos VIP

## Objetivo
Um link por evento, aberto a qualquer pessoa, que leva a cliente do produto até o pagamento sozinha (domingos/feriados, sem vendedora).

## O que reaproveita
- **Catálogo da live (crossell):** produtos ativos do `event_catalog_products`, preço (oferta ou original), variantes habilitadas com estoque, frete grátis/promoção por item e o cálculo de condições (`compute_live_order_conditions`). Hoje isso só abre via função `live-catalog` com token pessoal.
- **Tela do catálogo:** a mesma página visual do `/pedido/:slug/catalogo/:token` (cards, cor/numeração, carrinho), em modo "público".
- **Autoatendimento:** identificação por WhatsApp (`identify`), ficha (nome, CEP/endereço, CPF, e-mail), frete do evento, cashback e a página de carrinho/pagamento `/pedido/:slug/carrinho/:orderId` com a cascata de gateways atual (Pix MP, cartão, divisão de pagamento).
- **Atribuição:** captura fbclid/UTM (`metaAttribution.ts`), Pixel + CAPI com event_id determinístico e Purchase com valor confirmado no servidor; rastreio `?d=` via `dispatch_link_access`.
- **Regras de pedido:** nunca dois carrinhos não pagos por cliente/evento (adiciona ao aberto); pagou antes → carrinho novo conforme regra do evento.

## O que é novo
1. **Endereço público:** `/pedido/:slug/vitrine` (o `/catalogo/:slug` já é usado por outra página). `?p=<id do item ou shopify_product_id>` abre focado no produto com o resto abaixo. Parâmetros `utm_source`, `utm_campaign`, `g=<grupo>`, `d=` aceitos.
2. **Configuração no evento:** liga/desliga e validade ("até X horas após a live" ou data fixa), botão "Copiar link público" na tela do catálogo da live, com montador de link por grupo/campanha.
3. **Função pública nova `live-catalog-public`** (ou modo novo da `live-catalog`): lê catálogo só se o link estiver ativo e dentro da validade; limite por IP; nunca aceita preço/frete/desconto do navegador, tudo recalculado no servidor; estoque conferido na hora (esgotado = não compra).
4. **Checkout sozinho:** WhatsApp primeiro → se já é cliente, pré-preenche o que for seguro (sem expor dados completos; mostrar mascarado) → completa ficha → cria/atualiza o pedido do evento com origem `vitrine_grupo` → manda para a página de pagamento existente.
5. **Registro de aberturas/cliques e vendas por grupo:** gravar abertura, produto visto e pedido com `utm_*`, `g` e `d` no pedido (attribution) e num registro de acessos. Preferência: reaproveitar `group_redirect_clicks`/registro de dispatch se servirem; senão uma tabela nova com RLS, sem acesso anônimo (grava só pela função).
6. **Relatório simples** na tela do evento: aberturas, pedidos e pagos por grupo/campanha.

## Pontos que preciso que você decida
- **Confirmação #CÓDIGO pelo WhatsApp:** hoje o autoatendimento só registra a cliente depois que ela manda o código no WhatsApp. No link público sem atendente, proponho **não exigir o código para comprar** (o pagamento já confirma), mas o pedido não marca "cadastrada para prêmio/sorteio". Ok?
- **Dados de cliente existente:** para não vazar dados de terceiros por quem digita um número qualquer, proponho mostrar só nome e endereço mascarados e pedir para confirmar/redigitar CPF. Ok?
- **Pedido após a live:** entra no mesmo evento (conta no faturamento da live) ou num canal separado "Vitrine Grupos"? Proposta: mesmo evento, com origem marcada e filtro.
- **Cashback:** mesmas regras do carrinho (10% até 20 min / 5% depois) contando a partir da criação do carrinho na vitrine?

## Riscos
- **Segurança:** página pública mexe em pedido e estoque. Mitigação: tudo pela função com limites por IP/telefone, valores só do servidor, sem leitura direta de tabelas pelo navegador.
- **Estoque concorrente:** duas clientes no último par. Reserva só no pagamento, como hoje; quem pagar depois cai no fluxo de pagamento sem estoque já existente.
- **Spam de pedidos falsos:** limite de carrinhos abertos por telefone/IP e expiração do carrinho não pago.
- **Desempenho:** 1 chamada ao abrir a página (catálogo em lote), sem polling; aberturas gravadas em lote leve.
- **Não quebrar:** link pessoal, modo manual e autoatendimento atuais ficam intactos.

## Detalhes técnicos
- Config do link: preferir colunas JSON já existentes do evento (ex.: settings); se não houver, coluna nova em `events` (`public_catalog_enabled`, `public_catalog_expires_at`, `public_catalog_token`) — migração aditiva.
- Função nova com `withAccessLog`, rate limit, sem JWT por ser pública (documentar na lista pública); RPC/tabelas novas com REVOKE anon.
- Pedido: `orders` com `link_origin='vitrine_grupo'` e attribution `{utm_source, utm_campaign, group_id, dispatch_code, fbc, fbp}`.
- Pixel: ViewContent ao abrir produto, InitiateCheckout ao ir pagar, Purchase na página de pagamento existente.
- Teste no evento add5e661…: abrir link, `?p=`, esgotado, cliente nova e existente, Pix, conferir atribuição; limpar o que criar. Não publicar sem autorização.
