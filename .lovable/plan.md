# Plano: Vincular produtos da Shopify ao nosso sistema (substituindo o Tiny)

## 1. Vai funcionar? Sim — e nossos dados estão prontos

Conferi o nosso catálogo agora. A base está limpa, que é exatamente o que precisamos pra "bater perfeitamente":

- **5.593 variações** no total
- **Todas (5.593) têm SKU** preenchido
- **5.024 têm GTIN** (código de barras) — as outras 569 só têm SKU
- **0 GTINs duplicados** e **0 SKUs duplicados** → cada código aponta pra um único produto, sem ambiguidade do nosso lado

Ou seja: do nosso lado, o casamento é seguro. O risco mora no lado da Shopify (códigos faltando ou diferentes lá), e é por isso que o plano tem uma etapa de **conferência antes de gravar qualquer coisa**.

## 2. Como o casamento vai funcionar (GTIN + SKU, em 2 passadas)

Para cada variação que existe na Shopify, tentamos casar nesta ordem:

```
1ª passada → comparar BARCODE da Shopify  ==  GTIN nosso   (mais confiável)
2ª passada → se não achou, comparar SKU da Shopify == SKU nosso
```

Cada variação da Shopify cai em uma de 3 listas:

```
 VERDE   = casou (por GTIN ou por SKU)  → pronto pra vincular
 AMARELO = casou por SKU mas o GTIN diverge, OU casou 2 vezes → revisar manual
 VERMELHO= não casou com nada           → não existe no nosso catálogo
```

**Nada é gravado na 1ª rodada.** Você recebe um relatório (quantos verdes, amarelos, vermelhos + a lista) e só depois autoriza a gravação dos verdes. Isso é o que garante o "bater perfeitamente": você vê antes.

## 3. O que acontece com o vínculo no Tiny (parte mais importante)

Aqui preciso ser 100% honesto pra não te criar uma expectativa errada:

**Vincular aqui NÃO desliga o Tiny sozinho.** Quem empurra estoque pra Shopify hoje é o próprio Tiny, e essa sincronização roda dentro do painel do Tiny, no horário dele. Eu não tenho como desligar isso pelo nosso sistema.

O que o nosso vinculador faz: grava nos nossos registros o `shopify_product_id` e o `shopify_variant_id` de cada produto. Isso permite que a **nossa** função de sincronização passe a escrever o estoque na Shopify. Mas:

```
Se o Tiny continuar ligado:
   Nós escrevemos estoque  →  depois o Tiny escreve por cima  →  Tiny vence
   (os dois brigam, e o último a sincronizar ganha)
```

Por isso, pra nossa vinculação "valer de verdade", são **2 passos que dependem de você no Tiny**:

1. **No painel do Tiny:** desativar/desconectar a integração Tiny ↔ Shopify (a sincronização de estoque desses produtos). É manual, do seu lado.
2. **Depois disso:** a nossa sincronização vira a única fonte que escreve na Shopify → estoque da Banana passa a mandar.

**Detalhe técnico extra:** na Shopify, cada variante tem um campo de "quem gerencia o estoque" (`inventory_management`). Quando o Tiny criou os produtos, ele pode ter se marcado como gestor. Nossa função de sincronização usa o endpoint de `inventory_levels` da Shopify, que funciona independente disso — então conseguimos escrever. Mas enquanto o Tiny estiver ativo, ele reescreve. A ordem correta é sempre: **vincular → desligar Tiny → sincronizar pela Banana.**

## 4. Ordem de execução recomendada

```
Fase 0  Backup mental: nada é destrutivo. Só GRAVAMOS shopify_id nos nossos
        registros. Não apagamos nada na Shopify nem no Tiny.

Fase 1  Vinculador em modo CONFERÊNCIA (dry-run)
        → lê todos os produtos da Shopify, casa por GTIN e depois SKU
        → devolve relatório verde/amarelo/vermelho, sem gravar

Fase 2  Você revisa o relatório (principalmente amarelos e vermelhos)

Fase 3  Vinculador em modo GRAVAÇÃO
        → grava shopify_product_id / shopify_variant_id só nos VERDES

Fase 4  VOCÊ desliga a sincronização Tiny → Shopify no painel do Tiny

Fase 5  Sincronização de estoque Banana → Shopify (função que já existe)
        → a partir daqui a Banana é a fonte da verdade
```

## 5. O que eu construo (parte técnica)

- **Nova função `shopify-link-products`** com 2 modos: `dry_run` (relatório) e `commit` (grava). Faz paginação de todos os produtos da Shopify (via Admin API, paginação por cursor), monta o índice GTIN→variação e SKU→variação a partir do nosso `product_variants`, e classifica verde/amarelo/vermelho.
- **Tela de revisão** (no módulo de Estoque): botão "Vincular Shopify", roda o dry-run, mostra os contadores e a lista, e um botão "Confirmar vínculos" que chama o modo commit.
- **Reaproveitamento**: a sincronização de estoque (`sync-master-product-stock`) já existe e já escreve na Shopify por variante — não precisa refazer, só usar depois do vínculo.
- **Relatório de divergências**: exporto a lista de amarelos/vermelhos pra você tratar (cadastrar no nosso sistema ou corrigir código).

## Resumo da resposta direta às suas perguntas

- **"Vai funcionar mesmo?"** Sim. Nosso lado está sem duplicidade e 100% com SKU. O casamento por GTIN+SKU é seguro, e a etapa de conferência garante que você valida antes de gravar.
- **"Validar por GTIN e SKU?"** Sim — GTIN primeiro (mais confiável), SKU como segundo critério. É exatamente o que você pediu.
- **"O que acontece com o Tiny?"** O vínculo aqui não mexe no Tiny. Pra nossa vinculação valer, você precisa desligar a sincronização Tiny→Shopify no painel do Tiny. Senão os dois brigam e o Tiny sobrescreve.
