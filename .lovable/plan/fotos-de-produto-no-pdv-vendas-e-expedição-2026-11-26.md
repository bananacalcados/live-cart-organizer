# Fotos de produto no PDV (Vendas e Expedição)

Objetivo: miniatura do produto no carrinho do PDV e em todos os itens da Expedição, sem atrasar o bipe nem o fechamento da venda, e sem nenhuma consulta nova quando o interruptor estiver em "off".

## 1) Telas tocadas e onde a foto entra

Vendas (`src/components/pos/POSSalesView.tsx`)
- Linha do carrinho: quadrado fixo de 40×40 à esquerda do nome. Até carregar, ou se falhar, fica cinza.
- Último item bipado: foto média de 96×96 no cartão de resumo do carrinho, só no desktop (≥ lg). No celular não aparece, para não empurrar o carrinho para baixo.
- Clique na miniatura amplia a foto (mesma ampliação usada em Fotos por cor).

Expedição (`src/components/pos/expedition/`)
- `POSExpedition.tsx`, lista de itens no cartão do pedido (todas as etapas: Novos, Preparação, Separação, Aguardando, Conferência, Concluídos): 32×32 antes do nome do item.
- `ExpConferenceDialog.tsx`: 56×56 à esquerda de cada item conferido. É onde a foto mais ajuda, porque mostra o par certo na hora de bipar.
- `ExpPickingList.tsx` (lista de separação): 40×40 por linha. Na impressão a foto não aparece.
- `ExpWaitingPanel.tsx` e `ExpAdvancePickDialog.tsx`: 32×32 por item.
- `ExpBuyListPanel.tsx` (Lista de Compras): 40×40 por produto/cor, só quando a linha tiver código de barras ou SKU. Grade sem produto cadastrado fica cinza.
- Fora do escopo: os diálogos de edição (`ExpItemsEditDialog`, `ExpAvulsoEditDialog`) e os de preço. São telas de edição, e a foto ali não ajuda.
- Em todas: clique amplia a foto.

## 2) Como achar a foto de cada item, em lote (uma peça só para as duas telas)

- Novo hook `useItemPhotos(keys)` em `src/hooks/useItemPhotos.ts` e componente `ItemPhotoThumb` (tamanho fixo, `loading="lazy"`, `decoding="async"`, `onError` vira cinza sem aviso).
- Chave do item: código de barras; se não tiver, SKU.
- Uma única função no banco, `pos_item_photos(p_keys text[])`:
  - roda com a permissão de quem chama (SECURITY INVOKER), então respeita as regras de acesso de cada tabela;
  - teto de 200 chaves, e só aceita links do serviço de fotos;
  - caminho: `pos_products` (barcode ou sku) → `parent_sku = products_master.sku_root` → cor via `product_color_codes.color_key` (se houver para aquele master e cor) ou `colorSlug(pos_products.color)`, com a mesma regra de slug reproduzida em SQL e testada contra `colorSlug`;
  - foto: primeira da cor do item (menor position, depois mais antiga); se não houver, primeira "geral"; se não houver, nada. Nunca usa foto de outra cor;
  - retorna `{key, thumb, medium, full}`, só para as chaves que tiverem foto.
- Cache: React Query, chave `["item_photos", key]` por item, `staleTime` de 30 min, sem refetch ao focar a janela. O hook só pede as chaves que ainda não estão no cache, agrupadas num lote com espera de 150 ms (vários bipes seguidos viram uma chamada só).
- Vendas: o bipe adiciona ao carrinho na hora, como hoje; a foto chega depois. A venda e o fechamento não leem nada do hook.
- Expedição: pede só as chaves dos pedidos já carregados na página/etapa visível, nunca o histórico.
- Antes de entregar: conferir por EXPLAIN que a busca por barcode/sku em `pos_products` e em `products_master.sku_root` usa índice existente. Se algum não usar, aviso antes de criar índice.

Quantas consultas ao abrir: 1 leitura do interruptor (já em cache, 5 min) + 1 chamada em lote por grupo de itens novos (carrinho: 1 por rajada de bipes; Expedição: 1 por troca de etapa/página). Nada se repete sozinho e não há polling.

## 3) Permissão (migração proposta)

- Nova função de checagem `can_view_product_photos()` (SECURITY DEFINER, search_path fixo, EXECUTE só para authenticated, revogado de PUBLIC/anon): devolve true para admin ou para quem tem módulo `inventory`, `pos` ou `expedition`.
- Nova política só de leitura em `product_color_photos`: `FOR SELECT TO authenticated USING (public.can_view_product_photos())`.
- Inserir, alterar e apagar continuam só com as políticas atuais (inventory/admin). Nada para anon.
- `pos_item_photos`: EXECUTE só para authenticated e service_role.
- Módulos que passam a ler: `pos` (vendedoras) e `expedition`. `inventory` e admin já liam.
- Interruptor: hoje "admin" mostra fotos só para admin e "on" para admin + estoque. Proposta: no PDV, "admin" continua mostrando só para admin; "on" mostra para quem tem pos/expedition. Assim o Matthews testa como admin antes de liberar para a equipe.

## 4) Itens da Expedição que não são do PDV (Shopify, live, avulso)

- Todos os itens da Expedição já são linhas de venda do PDV, com código de barras e SKU gravados. A busca usa esses dois, nessa ordem.
- Shopify e live normalmente trazem o GTIN, que bate com o código de barras em `pos_products`. Se não bater, tenta o SKU.
- Não dá para identificar (sem código, código de outro sistema, item avulso digitado): quadrado cinza. Não adivinho por nome, porque poderia mostrar o produto ou a cor errada.
- Se o produto existe mas a cor dele não tem foto: usa a "geral" ou fica cinza.

## 5) Riscos e como o "off" desfaz

- Risco de travar o bipe: evitado porque a foto fica em hook separado, nunca dentro da função de adicionar ao carrinho nem do fechamento.
- Risco de layout (linha mais alta, celular apertado): tamanhos fixos; a foto grande não aparece no celular; conferir em 375 px e no desktop.
- Risco de carga: lote com teto de 200 chaves, cache de sessão, nenhuma consulta por linha, nenhum gatilho ou cron novo.
- Risco de foto errada: nunca usa outra cor nem busca por nome.
- Risco de permissão: a política nova é só de leitura; o resto não muda.
- "off": o hook lê o interruptor primeiro. Em "off" não chama `pos_item_photos` e não desenha a miniatura (nem o quadrado cinza), então a tela fica idêntica à de hoje. Voltar para "admin" ou "on" reativa sem publicar.

## 6) Testes

Vou rodar:
- Unitários: regra de escolha (cor > geral > nada, nunca outra cor; desempate por position e depois data); slug SQL igual a `colorSlug`; o hook não chama nada em "off" e só pede chaves que faltam; teto de 200.
- SQL em transação desfeita (rollback): vendedora com só `pos` lê a foto mas não consegue inserir/alterar/apagar; usuário sem módulo não lê; anon não executa.
- Navegador como admin, com o interruptor no estado atual: bipar um produto com foto, um sem foto e um com só "geral"; abrir a Expedição nas etapas e na Conferência; prints no desktop e no celular. Nenhuma venda é fechada e nenhum item sai de etapa.
- EXPLAIN das consultas novas.

Não vou conseguir testar:
- Bipe com leitor físico e velocidade real numa loja cheia.
- Login real de uma vendedora (testo a permissão pelo banco, simulando o papel dela).
- Itens Shopify cujo GTIN não exista no PDV: só confiro quantos são, sem corrigir nada.

Fases (cada uma pode ser desfeita sozinha):
1. Permissão + função `pos_item_photos` + testes do banco.
2. Hook, miniatura e carrinho de Vendas.
3. Expedição (cartões, Conferência, separação, aguardando, lista de compras).

Não publico. Haverá mudança de front.

## Detalhes técnicos
- Arquivos novos: `src/hooks/useItemPhotos.ts`, `src/components/pos/ItemPhotoThumb.tsx`, `src/lib/itemPhotoPick.ts` (regra pura, testável), testes em `src/test/`.
- Regra registrada no AGENTS.md do PDV: fotos do PDV só via `pos_item_photos` em lote, atrás do interruptor.
