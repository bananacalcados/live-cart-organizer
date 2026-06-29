# Plano — Crossell no link do checkout da Live

Antes de qualquer alteração no checkout, este é o plano por etapas. Só implemento após sua aprovação. Nada do checkout atual é removido — o crossell é uma camada nova, sempre opcional por evento.

## Conceito (regras de negócio confirmadas)
- O crossell é configurado **por evento**, selecionando 3–5 produtos da Shopify, cada um com **valor original** e **valor com desconto**.
- A oferta só aparece **para quem já tem produto no carrinho/pedido** (o pedido criado no evento já tem itens).
- Se o carrinho só tiver **1 item e esse item for um dos produtos da oferta**, esse produto **não é ofertado** (conta valor normal); os demais produtos da oferta continuam aparecendo.
- **Calçados**: só mostrar opções que tenham estoque no **mesmo tamanho** do(s) calçado(s) já no pedido. **Acessórios sem tamanho** (bolsa, mochila, meia…) aparecem sempre.
- A foto puxada é a da **variação de cor** disponível naquele tamanho. Se houver mais de uma cor disponível no tamanho do cliente, cada cor vira um **bloco separado** no carrossel.
- Modal grande, carrossel **com rolagem lateral** (scroll horizontal, sem botões de avançar), fotos grandes, mostrando cor + tamanho + valor normal e com desconto, e um **título** explicando que é uma condição especial por já ter um produto no carrinho.
- **Cronômetro regressivo de 2 minutos** ao abrir o modal.
- Adicionar/remover crossell **reflete em tempo real no card do pedido do evento** (via webhook/realtime). O cliente **só pode remover itens de crossell**, nunca o item original do pedido.
- Desconto **sempre** aplicado em cima do produto de crossell — nunca abatido no produto original.
- Vínculo do crossell é **pelo pedido/checkout** (order_id), evitando que a mesma oferta seja contada em 2 pedidos do mesmo cliente no mesmo evento.

## Como o checkout funciona hoje (base para não quebrar)
- O link é `/checkout/order/:orderId`. O checkout carrega o pedido via RPC `get_checkout_order(p_order_id)` e os dados do cliente via `get_checkout_registration`.
- Os itens ficam em `orders.products` (JSONB, lista de itens com title/variant/price/image/quantity).
- Frete via `checkout-quote-freight` (recebe `order_id`/`total_value`); parcelamento por evento já existe.
- Imagem por variação de cor já existe em `getVariantImage` (lib/shopify).

---

## Etapa 1 — Banco de dados (migração)
Criar a base, sem mexer em nada existente.

1. Tabela `event_crossell_offers` (config por evento):
   - `event_id`, `shopify_product_id`, `shopify_variant_handle/title`, `original_price`, `discount_price`, `has_sizes` (bool), `position`, `is_active`.
   - GRANTs + RLS (leitura autenticada; leitura anônima necessária para o checkout público — via RPC security definer, ver Etapa 3).
2. Tabela `order_crossell_items` (o que cada pedido adicionou):
   - `order_id`, `event_id`, `offer_id`, `shopify_variant_id`, `title`, `color`, `size`, `image`, `original_price`, `discount_price`, `qty`, `added_at`.
   - Vínculo único por `order_id` para evitar duplicidade entre pedidos.
3. Coluna em `events`: `crossell_enabled boolean default false` (permite "evento sem crossell").

## Etapa 2 — Etapa nova no Wizard de configuração do evento
No `EventSetupWizard.tsx`, adicionar a etapa **"Crossell"** entre **Parcelamento** e **Ativar Live**.
- Toggle **"Realizar evento sem crossell"** (quando ligado, pula a seleção e marca `crossell_enabled=false`).
- Reaproveitar o seletor de produtos da Shopify (padrão já usado no projeto) para escolher 3–5 produtos.
- Sob cada produto selecionado: inputs **Valor original** e **Valor com desconto**, e detecção automática de "tem tamanho" (calçado) vs "sem tamanho" (acessório).
- Gravar em `event_crossell_offers`. A etapa conta como configurada quando: sem-crossell ligado **ou** ≥1 oferta salva.

## Etapa 3 — Backend de leitura para o checkout (edge functions/RPC)
Sem tocar no fluxo de pagamento atual.
1. RPC/edge `get_order_crossell(p_order_id)`:
   - Carrega ofertas do evento do pedido.
   - Lê os itens atuais do pedido para descobrir tamanho(s) de calçado e quais ofertas já estão no carrinho.
   - Para cada oferta de calçado, consulta Shopify (estoque por tamanho/cor) e retorna **só** as cores com estoque no tamanho do cliente; acessórios retornam sempre.
   - Aplica a regra "1 item só e é da oferta → não ofertar aquele".
   - Retorna blocos prontos (cor, tamanho, foto da variação, preço normal/desconto, variant_id).
2. Edge `checkout-add-crossell` e `checkout-remove-crossell`:
   - Inserem/removem em `order_crossell_items` e atualizam `orders.products` adicionando/removendo **apenas** o item de crossell, recalculando total com desconto isolado no item de crossell.
   - Disparam atualização realtime para o card do pedido no evento.

## Etapa 4 — Modal de Crossell no checkout (frontend)
Em `TransparentCheckout.tsx`, **adição isolada** (sem alterar o fluxo existente):
- Após o link carregar por completo, chamar `get_order_crossell`; se houver ofertas, abrir o modal grande.
- Título de condição especial + **cronômetro regressivo de 2 min** (ao expirar, fecha o modal).
- Carrossel horizontal com scroll lateral, fotos grandes, cor/tamanho/preços, botão **Adicionar ao carrinho** por bloco.
- Itens de crossell já no carrinho exibem botão **Remover** (somente eles). Item original nunca removível.
- Adicionar/remover chama as edges da Etapa 3 e atualiza o resumo do pedido na hora.

## Etapa 5 — Reflexo no card do pedido do evento (tempo real)
- `OrderCardDb.tsx` passa a exibir itens de crossell com tag distinta ("CROSSELL").
- Assinatura realtime (Supabase) em `order_crossell_items`/`orders` para refletir adição/remoção feita pelo cliente no link, sem reload.

## Etapa 6 — Salvaguardas anti-bug
- Desconto sempre atrelado ao próprio item de crossell (preço gravado no item), nunca aplicado no item original — remover crossell não altera valores do item original.
- Recalcular frete/parcelamento após mudança usando os fluxos atuais (que já recebem `order_id`).
- Vínculo por `order_id` garante que a oferta pertence a um único pedido daquele cliente no evento.
- Tudo opcional: evento com `crossell_enabled=false` ou sem ofertas → checkout funciona exatamente como hoje.

---

## Ordem de entrega sugerida
1. Migração (Etapa 1) → 2. Wizard/config (Etapa 2) → 3. Backend leitura/escrita (Etapa 3) → 4. Modal no checkout (Etapa 4) → 5. Card do evento + realtime (Etapa 5) → 6. Testes das salvaguardas (Etapa 6).

Confirme se aprova (ou ajuste qualquer etapa) que eu implemento começando pela migração. Não vou alterar o checkout antes do seu OK.