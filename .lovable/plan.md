## Objetivo

Resolver duas situações no módulo **Estoque**:

1. **Adicionar variações (cor/tamanho) em lote** a um produto que já existe — sem cadastrar uma por uma.
2. Quando entra uma **NF-e** com variações novas (cor nova, tamanho novo, ou os dois) de um produto **que já existe**, vincular ao produto pai e **criar a nova cor/tamanho automaticamente** sob esse pai, somando estoque.

---

## Situação 1 — Adicionar variações em lote (cadastro manual)

Hoje a tela de edição do produto (`ProductEditDialog`) só tem o botão **"+ Adicionar"**, que cria **uma linha vazia por vez**. O cadastro de produto novo (`ProductMasterForm`) já tem um **"Gerador de Matriz Cor × Tamanho"** (digita "Preto, Bege, Rosa" e "35, 36, 37" e ele gera todas as combinações). A ideia é levar essa mesma capacidade para a edição.

### O que vai mudar
- Adicionar na tela de edição do produto um bloco **"Gerar variações em lote (Cor × Tamanho)"**:
  - Campo de cores (separadas por vírgula) + campo de tamanhos (separados por vírgula) + grades rápidas (chinelo, infantil, etc.).
  - Botão **"Gerar"** cria todas as combinações de uma vez como variações novas.
  - **Anti-duplicidade**: combinações de cor+tamanho que já existem no produto são ignoradas (não duplica).
  - Campo opcional de **estoque inicial** e **custo** aplicado às novas linhas geradas.
- Corrigir uma lacuna importante: hoje, quando você adiciona uma variação nova pela edição, ela entra em `product_variants` mas **não vai para o PDV** (não aparece para vender/bipar). Vou fazer com que, ao salvar, as variações novas sejam **empurradas ao PDV em todas as lojas** (estoque compartilhado p/ Shopify), com o estoque entrando na **loja escolhida** — igual ao fluxo de criação de produto.
  - Para isso, será adicionado um seletor de **"Loja que recebe o estoque"** na edição (só aparece quando há variações novas).

Resultado: você abre o produto, digita as cores e tamanhos novos, clica em **Gerar**, escolhe a loja, salva — e tudo aparece no PDV/Shopify de uma vez.

---

## Situação 2 — NF-e com cor/tamanho novo de produto existente

Boa notícia: o caminho principal **já existe**. Na Entrada de NF-e, ao selecionar linhas e clicar em **"Vincular a pai existente"** (ou no atalho "Vincular esta" quando o GTIN bate), a função `nfe-link-items-pos` já:
- Procura a variação por GTIN e, se não achar, por **pai + cor + tamanho**;
- Se **não existir**, **cria a variação nova** (cor nova e/ou tamanho novo) sob o mesmo pai, em todas as lojas, com estoque entrando na loja escolhida;
- Se existir, **soma** a quantidade ao estoque.

Ou seja, "cor nova / tamanho novo / os dois" para um pai existente **já é tratado**. As melhorias do plano são para deixar isso claro e robusto:

### O que vai melhorar
- **Prévia antes de confirmar**: ao vincular, mostrar um resumo do tipo "3 linhas → 2 variações NOVAS serão criadas (Rosa 39, Verde 40) e 1 atualizada", para você confirmar conscientemente que está criando cor/tamanho novo.
- **Match de pai por GTIN parcial**: quando o GTIN de uma linha não bate com nada, mas **outra linha da mesma NF** já casou com um pai existente, sugerir vincular as demais linhas ao **mesmo pai** automaticamente (um clique para o grupo todo).
- **Espelhar no catálogo (opcional, recomendado)**: hoje o vínculo de NF-e grava só em `pos_products` (fonte da verdade do estoque, conforme definido). As variações novas criadas pela NF-e **não aparecem** na tela de edição do produto (que lê `product_variants`). Vou alinhar isso para que a cor/tamanho novo criado pela NF-e **também apareça** no cadastro do pai, evitando a sensação de "sumiu". (Confirmar se você quer esse espelhamento — ver pergunta abaixo.)

---

## Detalhes técnicos

**Arquivos afetados**
- `src/components/inventory/ProductEditDialog.tsx`: novo bloco de matriz cor×tamanho; dedupe contra variações existentes; seletor de loja; ao salvar, chamar `create-master-product-pos` (idempotente, faz upsert de todas as variações) para empurrar as novas ao PDV com estoque na loja escolhida.
- `src/components/inventory/NfeDetailEditor.tsx`: prévia de "novas vs atualizadas" antes de vincular; sugestão de pai por grupo via GTIN já casado.
- `supabase/functions/nfe-link-items-pos/index.ts`: retornar no payload quais variações foram criadas vs atualizadas (para a prévia); opcionalmente espelhar em `products_master`/`product_variants`.

**Confirmações da base (já verificadas)**
- Não há trigger ligando `product_variants` → `pos_products` (por isso variações novas na edição não chegam hoje ao PDV — será corrigido).
- `create-master-product-pos` lê todas as variações do master e faz upsert no PDV em todas as lojas — reaproveitável para empurrar as novas.
- `nfe-link-items-pos` já cria variação nova por cor/tamanho inexistente sob o pai e soma estoque.

```text
NF-e (linha: cor/tam novo)
        │  "Vincular a pai existente" / atalho GTIN
        ▼
 nfe-link-items-pos
        │  acha por GTIN? acha por pai+cor+tam?
        ├── não → CRIA variação nova (cor/tam novo) em todas as lojas + estoque na loja escolhida
        └── sim → SOMA estoque
```

---

## Pergunta antes de implementar

No vínculo de NF-e, quando uma **cor/tamanho novo** é criado, você quer que ele apareça **também na tela de edição do produto** (catálogo `product_variants`), além de já aparecer no PDV/Shopify? Isso evita a sensação de "criei pela NF-e mas não vejo no cadastro". Sem isso, a variação existe e vende normalmente, mas só aparece na listagem do PDV.
