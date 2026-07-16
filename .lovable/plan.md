
# Transferência de Estoque entre Lojas + fim do reload ao corrigir

## Onde vive hoje

Clicando no número de estoque de uma variação em **Controle de Estoque > Loja X > Produtos > Catálogo Unificado**, abre o `PosSkuEditDialog` (em `src/components/inventory/UnifiedProductsList.tsx`, linhas 804-887). Hoje ele só edita SKU, código de barras, preço, custo e estoque **daquela loja**, e ao salvar dispara `onSaved()` que chama `load()` — a função `load()` refaz o fetch de tudo (masters + todos os `pos_products` em lotes de 1000 + lojas). Por isso a página inteira "recarrega" e você perde o produto expandido.

## Parte 1 — Nova aba "Transferir Estoque" no modal

Reestruturar o `PosSkuEditDialog` em duas abas (`Tabs` do shadcn):

1. **Editar** — mantém exatamente o comportamento atual (SKU / barcode / preço / custo / estoque).
2. **Transferir** — nova aba:
   - Mostra: nome do produto, cor, tamanho, loja origem e estoque atual (readonly).
   - Campo **Quantidade** (número, mínimo 1, máximo = estoque da origem — bloqueia envio se maior).
   - Campo **Loja destino** (`Select` com as outras lojas reais — filtra `is_active=true AND is_simulation=false` e exclui a loja origem).
   - Mostra estoque atual da loja destino para a mesma variação (se existir cadastro), buscando por `barcode` OU `parent_sku+color+size`.
   - Campo **Motivo** (opcional).
   - Botão **Transferir**.

Regras de negócio da transferência:
- Origem: `stock -= quantidade`.
- Destino: se a variação já tem cadastro na loja destino (match por `barcode` quando existe; senão por `parent_sku+color+size`), soma `stock += quantidade`. Se não existe, cria a linha copiando o cadastro completo (`parent_sku, name, sku, barcode, color, size, variant, price, cost_price, category, brand, image_url, is_active, price_tier_id`, etc.) com `stock = quantidade`.
- Registra 2 linhas em `pos_stock_adjustments`: uma `type='saida'` na origem e uma `type='entrada'` no destino, com `reason='Transferência entre lojas'` e um `transfer_id` (UUID compartilhado) para rastreio.
- Nunca deixar `stock` negativo na origem (validação server-side).
- O trigger `apply_pos_sale_stock_movement` **não** dispara — usaremos ajustes diretos, então o mirror da Shopify é chamado explicitamente ao final (`shopify-mirror-stock` para o barcode/parent afetado — o estoque total compartilhado não muda, mas invocamos para garantir consistência).

## Parte 2 — Edge function `pos-stock-transfer`

Nova função em `supabase/functions/pos-stock-transfer/index.ts`:

- Input: `{ source_product_id, dest_store_id, quantity, reason? }`.
- Valida: `quantity>0`, `source.stock >= quantity`, `dest_store_id` é real (`is_simulation=false`, `is_active=true`), lojas diferentes.
- Resolve/cria a linha destino (match por barcode; fallback por parent_sku+color+size).
- Executa `UPDATE` de origem e destino + `INSERT` dos 2 ajustes numa única invocação (sequencial com SERVICE_ROLE), tudo com `transfer_id = gen_random_uuid()`.
- Rollback simples se o segundo update falhar (reverter o primeiro).
- Retorna `{ success, source: {store, new_stock}, dest: {store, new_stock, created?} }`.

Sem migration de schema (usa colunas já existentes). Se quisermos rastreabilidade forte, adicionamos depois uma coluna opcional `transfer_id UUID` em `pos_stock_adjustments`.

## Parte 3 — Fim do reload total no modal

O reload existe porque `PosSkuEditDialog.onSaved` chama `load()`. Vou trocar o contrato:

- Novo prop `onLocalUpdate(patch: Partial<PosSku> & { id: string })` no `PosSkuEditDialog`.
- No `UnifiedProductsList`, passar:
  ```
  onLocalUpdate={(patch) => setPosProducts((prev) =>
    prev.map((p) => (p.id === patch.id ? { ...p, ...patch } : p))
  )}
  ```
- No `save()` do modal, após sucesso, chamar `onLocalUpdate({ id, sku, barcode, price, cost_price, stock })` e fechar o dialog. Nada de refetch.
- Para a aba **Transferir**, o mesmo mecanismo:
  - Atualiza o `stock` da linha origem (`onLocalUpdate`).
  - Se destino já existia, atualiza também. Se foi criado, faz um `setPosProducts((prev) => [...prev, novaLinha])` retornando a linha nova pela edge function.
- Botão manual "Recarregar" continua disponível para o caso raro de divergência.

Efeito: você fica no mesmo produto expandido, no mesmo scroll, e vai corrigindo as variações uma a uma sem perder o contexto. Vale também pra transferências: você transfere 1 par e continua vendo a grade atualizada.

## Fora do escopo (não altero agora)

- Balanço/entrada/saída simples via `ProductStockManagerDialog` (aquele modal separado): mantém como está — o pedido foi só o modal do Catálogo Unificado.
- Nenhuma mudança em schema (nada de nova coluna / policy nova / trigger novo). Nenhuma mudança em outras telas.
- Não mexo em `MassTemplateDispatcher`, agente de marketing, ou nas funções da Fase A/B de estoque.

## Segurança / riscos

- Edge function usa SERVICE_ROLE — validações server-side impedem: quantidade zero/negativa, exceder estoque origem, loja de simulação, loja igual origem.
- Todas as respostas da função incluem `corsHeaders`.
- O trigger `trg_reactivate_pos_product_on_stock` reativa automaticamente o destino quando ganha estoque — comportamento desejado.
- Se a criação da linha destino colidir com o índice `(store_id, sku, variant)` (produto já existe com barcode em branco), a função faz `SELECT` prévio e tenta 2 estratégias de match antes de inserir; se ainda assim colidir, retorna erro claro pedindo revisão manual — não deixa estoque "sumir".

## Arquivos que serão tocados na implementação

- `src/components/inventory/UnifiedProductsList.tsx` — `PosSkuEditDialog` vira Tabs + novo prop `onLocalUpdate`; remove `load()` do fluxo de salvar.
- `supabase/functions/pos-stock-transfer/index.ts` — nova.
- Nada mais.
