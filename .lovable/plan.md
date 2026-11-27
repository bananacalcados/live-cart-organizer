# Produtos do ERP no lugar da Shopify — estudo e plano por fases

Estudo apenas. Nada foi alterado. Os pontos marcados como "confirmar na Fase 0" ainda não foram lidos linha a linha.

## 1. Inventário (o que lê produto da Shopify hoje)

| Tela / função | Para que serve | O que usa do produto | O que grava depois | Módulo |
|---|---|---|---|---|
| LiveSessionManager | Montar pedido durante a live | nome, foto, preço, tamanho, id da variação, SKU | item no pedido (`shopifyId`, `sku`) e cria pedido na Shopify pelo botão | Live |
| ProductSelector | Seletor de produto do pedido (ficha/carrinho) | nome, foto, preço, "de", tamanhos, disponível, id da variação | item do pedido (`shopifyId`, `sku`, preço, tamanho) | Live |
| dbOrderStore | Guarda os itens do pedido | id da variação, SKU | itens do pedido | Live |
| ActiveProductBar | Produto em destaque na live / painel da apresentadora / overlay | nome, foto, preço | produto ativo do evento | Live |
| LiveCodeIntentLane | "Pedidos por código" | código, nome, foto, tamanhos | item no pedido | Live |
| LiveShownProductsPanel + productCodeImages | Produtos preparados/mostrados | foto do espelho da Shopify | nada | Live |
| LivePromotionsManager | Promoções da live | nome, preço, "de" | regras da promoção | Live |
| ShopifyImagePicker + useShopifyVariantImages | Escolher foto de produto/variação | fotos | link da foto | Live / WhatsApp |
| liveCatalog + EventCatalogManager | Catálogo da live (página pública e carrinho) | nome, fotos, preço, "de", tamanhos, disponível, id da variação | produtos do catálogo e item do carrinho | Catálogo público |
| CrossellBlocksEditor / CrossellConfigStep + checkout-crossell | Oferta de cross-sell | nome, foto, preço, id da variação | item adicional no pedido | Cross-sell |
| LiveCommerce (página) | Vitrine pública da live | nome, fotos, preço, coleção | carrinho | Catálogo público |
| DoseTriplaCatalog / CatalogLeadPage | Catálogos públicos de captação | nome, fotos, preço, "de", coleção | lead / carrinho | Catálogo público |
| POSProductCatalogSender | Enviar foto/catálogo pelo WhatsApp (PDV e live) | nome, fotos, preço, tamanhos | só a mensagem | WhatsApp |
| POSOnlineSales | Venda online pelo PDV | nome, preço, tamanho, id da variação | venda / link de pagamento | PDV |
| CatalogLandingPageCreator / CatalogLeadPageCreator / LinkPageManager + link-page-catalog-sync | Criar páginas de catálogo e Link Pages | nome, fotos, preço, coleção | lista de produtos da página | Marketing |
| AutomationFlowBuilder / ScheduledMessageForm | Mensagens com produto | nome, foto, preço | texto/imagem da mensagem | Marketing |
| livete-tools / check-order-stock | IA da live e checagem de estoque | nome, tamanho, disponível | resposta / alerta | IA |
| shopify-create-live-order / -create-order / -draft-order / criar-pedido-externo / yampi | Criar pedido externo | id da variação | pedido na Shopify / link | Servidor |

Não vi chamadas automáticas a shopify-create-live-order: no checkout está comentada, e o LiveSessionManager só usa pelo botão manual. Isso bate com a regra "nada de pedido automático na Shopify".

## 2. O que acontece depois da escolha (o ponto principal)

- **O item do pedido da live** guarda `shopifyId` (id da variação Shopify) e `sku`.
- **Pedido pago para o PDV:** a função que manda o pedido ao PDV (event-order-route-to-pos) grava os itens da venda só com nome, tamanho, SKU, preço e quantidade. Ela **não usa o id da Shopify**.
- **Baixa de estoque, Expedição, NF e comissão** saem da venda do PDV, que se liga pelo SKU. Ou seja: o que importa é ter o SKU do ERP certo. Confirmar na Fase 0 se a baixa de estoque casa pelo SKU ou pelo código de barras.
- **Pedido na Shopify:** só sai pelo botão manual e precisa do id da variação. Um produto fora da Shopify não pode ir por esse botão.

O que quebraria hoje com um produto que **não está na Shopify**:
- **Carrinho e pagamento:** funcionariam, porque o preço vem do item. Confirmar na Fase 0 se o checkout recalcula o preço pela Shopify.
- **Botão de pedido na Shopify:** falharia. Precisa esconder ou pular esses itens.
- **Cross-sell (checkout-crossell):** provavelmente exige o id da Shopify. Confirmar.
- **Estoque, Expedição e NF:** funcionam se o SKU do ERP for gravado.
- **Verificação de pedidos e duplicatas da Shopify:** precisam ignorar itens sem id.

**Caminho mais seguro:** o item passa a ser identificado pela variação do ERP (`erp_variant_id` + `sku`). O `shopifyId` continua preenchido quando existir. Produto só do ERP não vai para a Shopify: fica só no PDV, sem item avulso lá.

**O que já existe pronto:** os itens de venda do PDV já aceitam item sem Shopify (só SKU e nome). A Expedição e a NF já trabalham assim.

## 3. Proposta: uma fonte única de produtos do ERP

**Consulta no servidor**
- Uma consulta segura `erp_catalog_search(texto, filtros, limite≤50, offset)`.
- Busca por nome, etiqueta, GTIN, SKU ou código do pai, reaproveitando o mesmo reconhecimento de código do estoque no celular.
- Devolve por produto:
  - nome;
  - cores e tamanhos (variações ativas);
  - preço do cadastro;
  - preço "de" (ver lacunas);
  - foto por cor do ERP. Se o ERP não tiver, usa a foto da Shopify espelhada; se nenhuma existir, fica sem foto;
  - estoque por loja, com destaque para a Pérola (que é de onde sai a venda Site/Live);
  - código interno da live, SKU e id da variação Shopify quando houver.

**Na tela**
- Um adaptador transforma esse resultado no mesmo formato de produto que as telas já usam. Assim, as telas trocam só a origem.
- Um seletor compartilhado, com busca e "carregar mais".

**Desempenho**
- Hoje cada tela baixa até 250 produtos completos da Shopify, com 20 fotos e 100 variações cada. Isso costuma levar de 1 a 3 s e pesa no celular.
- A proposta traz 30 a 50 por vez, estimado em menos de 150 ms.
- Perda: não dá mais para filtrar tudo no navegador. Todo filtro vai para o servidor.
- Sem polling. Cache só durante a sessão.
- Vender sem estoque continua permitido.

## 4. Fases (cada uma com interruptor em app_settings)

Interruptores: `product_source_live`, `product_source_crossell`, `product_source_whatsapp`, `product_source_marketing`, com os valores `shopify` ou `erp`. O padrão é `shopify`.

**Fase 0 — conferência, sem mudança de tela**
- Confirmar os pontos marcados acima.
- Criar a consulta e o adaptador.
- Testes comparando produtos da Shopify e do ERP para os 417 ligados: mesmo nome, preço, SKU e id.

**Fase A — seletores da LIVE**
- Telas: ProductSelector, LiveSessionManager, ActiveProductBar (apresentadora/overlay), LiveCodeIntentLane, LiveShownProductsPanel e LivePromotionsManager.
- **Para a equipe:** aparecem os 87 produtos com estoque fora da Shopify, com foto do ERP quando houver.
- **Fica igual:** o item continua gravando `shopifyId` quando existir, e passa a gravar também `sku` e `erp_variant_id`.
- **Ajuste necessário:** o botão de pedido Shopify ignora e avisa sobre itens só do ERP.
- **Risco:** preço "de" diferente e foto faltando.
- **Teste:** pedido simulado com produto ligado e com produto só do ERP, indo ao PDV e Expedição em rollback.
- **Desfazer:** interruptor de volta para `shopify`.

**Fase B — cross-sell e catálogo da live**
- Telas: EventCatalogManager, liveCatalog, live-catalog-public, CrossellBlocksEditor/ConfigStep e checkout-crossell.
- Páginas públicas recebem só o necessário, pela função pública.
- **Risco:** o checkout do cross-sell exigir o id da Shopify.
- **Teste:** carrinho público simulado.
- **Desfazer:** interruptor.

**Fase C — WhatsApp (live e PDV)**
- Telas: POSProductCatalogSender, ShopifyImagePicker/useShopifyVariantImages e POSOnlineSales.
- Envio de foto por cor do ERP. Produto sem foto fica marcado e não é enviado.
- **Teste:** envio para o número de teste.
- **Desfazer:** interruptor.

**Fase D — marketing**
- Telas: Link Pages, páginas de catálogo, DoseTripla, CatalogLeadPage, automações e mensagens agendadas.
- **Risco:** filtros por coleção.
- **Desfazer:** interruptor.

## 5. O que não muda

- O site da Shopify continua sendo a loja online.
- As sincronizações do ERP para a Shopify (estoque somado, preços, cores) continuam.
- Os pedidos de produtos ligados continuam indo para a Shopify como hoje, só pelos botões manuais.
- O PDV, a Expedição e a NF não mudam.

## 6. Lacunas de dados para resolver antes

- **Fotos:** 85 dos 87 produtos com estoque fora da Shopify não têm foto no ERP. Sugiro uma lista de pendências.
- **Preço "de":** hoje vem do "compare at" da Shopify. O ERP precisa de um campo próprio, ou copiar o valor da Shopify uma vez.
- **Descrição:** a das páginas públicas vem da Shopify. Usar a do cadastro ou deixar vazia.
- **Coleções:** usadas em LiveCommerce, catálogos e Link Pages. Trocar por categoria/marca do ERP, ou manter a coleção vinda do espelho.
- **Cores:** cor do ERP diferente da cor da Shopify. Usar os apelidos de cor já existentes para casar a foto espelhada.
- **Variações inativas:** mostrar só as ativas e não esconder produto sem estoque.

## 7. Perguntas para o Matthews

1. Produto só do ERP vendido na live pode ficar só no PDV, sem pedido na Shopify?
2. Produto sem nenhuma foto aparece no seletor com um quadrado cinza ou fica escondido?
3. De onde vem o preço "de": campo novo no ERP ou cópia única da Shopify?
4. Nos catálogos, a categoria/marca do ERP pode substituir as coleções da Shopify?
5. Começamos a Fase A em todas as lives ou primeiro numa live de teste?

## Detalhes técnicos

- O item do pedido ganha `erp_variant_id` e `erp_master_id`, que são opcionais no JSON de `orders.products`, sem mudar a tabela.
- A consulta deve ser SECURITY DEFINER com checagem de permissão, teto de 200 e índices já existentes (código/GTIN/SKU).
- A versão pública da consulta não expõe custo nem estoque exato.
