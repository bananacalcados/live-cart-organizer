

# Catalogo Interativo v2 — Carrinho Interno + Checkout Yampi

## Problemas Atuais (Bugs)

### 1. Produtos nao aparecem na busca do criador
O componente `CatalogLandingPageCreator` carrega produtos da Shopify corretamente, mas o grid de selecao de produtos esta dentro de um `ScrollArea` com altura fixa de 300px dentro de um `AccordionItem` que ja esta dentro de outro `ScrollArea` do dialog. O aninhamento de ScrollAreas causa problemas de renderizacao. Alem disso, a busca funciona apenas por titulo no frontend — se a Shopify retornar paginado ou com delay, pode parecer vazio.

### 2. Layout apertado no editor
O dialog usa `max-w-2xl` que e pequeno para a quantidade de campos. Precisa ser expandido para `max-w-4xl` ou ate tela cheia, e a area de produtos precisa de mais espaco visual.

## Nova Feature: Carrinho Interno na Landing Page

### Fluxo do Usuario

```text
+------------------+     +------------------+     +------------------+
| 1. Boas-vindas   |---->| 2. Categoria     |---->| 3. Grid produtos |
|                  |     |                  |     |   + Botao "Add"  |
+------------------+     +------------------+     +------------------+
                                                         |
                                                         v
                                              +---------------------+
                                              | 4. Carrinho flutuante|
                                              |    com contador     |
                                              +---------------------+
                                                         |
                                                         v
                                              +---------------------+
                                              | 5. Tela do carrinho |
                                              |  - Lista de itens   |
                                              |  - Nome + WhatsApp  |
                                              |  - Aviso de reserva |
                                              +---------------------+
                                                    |       |       |
                                                    v       v       v
                                              +-------+ +------+ +------+
                                              | Yampi | | WhApp| | Loja |
                                              +-------+ +------+ +------+
```

### Detalhes Tecnicos

#### 1. Correcoes de Bug no `CatalogLandingPageCreator.tsx`

- Expandir dialog de `max-w-2xl` para `max-w-5xl` com layout em 2 colunas (config a esquerda, preview de produtos a direita)
- Remover ScrollArea aninhada na secao de produtos — usar grid com scroll nativo
- Garantir que `loadShopifyProducts()` carrega mesmo quando ja tem cache (forcando reload se necessario)
- Aumentar a area de visualizacao dos produtos para pelo menos 400px de altura

#### 2. Estado do Carrinho na Landing Page (`DoseTriplaCatalog.tsx`)

Novo estado local no componente:

- `cart: FilteredProduct[]` — lista de produtos adicionados
- `cartStep: boolean` — se esta mostrando a tela do carrinho
- `customerName: string` — nome do cliente
- `customerPhone: string` — WhatsApp do cliente
- `checkoutLoading: boolean` — estado de loading durante criacao do link

#### 3. Botao Flutuante do Carrinho

- Icone de carrinho fixo no canto inferior direito
- Badge com contagem de itens
- Animacao de "bounce" ao adicionar item
- Ao clicar, abre a tela do carrinho

#### 4. Cards de Produto Atualizados

Substituir os 3 botoes atuais (Site, WhatsApp, Loja) por:

- **Botao unico "Adicionar ao Carrinho"** — adiciona o produto ao estado local
- Se o produto ja esta no carrinho, mostrar botao "Adicionado" (desabilitado ou com opcao de remover)
- Aviso visual: "Todos os produtos adicionados serao separados no estoque. So adicione se tiver real intencao de compra."

#### 5. Tela do Carrinho (novo step "cart")

Layout:
- Lista dos produtos adicionados com foto, nome, cor, preco
- Botao de remover por item
- Resumo: total baseado nos combo tiers (ex: 3 itens = R$ 300)
- Calculo automatico do preco pelo combo tier mais proximo

Formulario obrigatorio:
- Campo "Seu nome"
- Campo "Seu WhatsApp" (com mascara)
- Aviso: "NAO ADICIONE AO CARRINHO SE NAO TIVER A INTENCAO DE FINALIZAR A COMPRA — Todos os produtos que voce adicionar serao separados automaticamente no estoque."

3 botoes de finalizacao:
- **Finalizar no Site (Yampi)**: chama `createYampiPaymentLinkFromOrder()` com os produtos do carrinho e redireciona
- **Finalizar no WhatsApp**: abre wa.me com round-robin e mensagem listando todos os produtos do carrinho
- **Retirar na Loja**: abre wa.me com mensagem de retirada listando todos os produtos

#### 6. Integracao com Yampi

A funcao `createYampiPaymentLinkFromOrder` ja existe em `src/lib/yampi.ts` e aceita `DbOrderProduct[]`. Sera necessario:

- Mapear os `FilteredProduct` do carrinho para o formato `DbOrderProduct` que a Yampi espera (com `shopifyId`, `sku`, `price`, `quantity`)
- Passar `customerName` e `customerPhone` nas opcoes
- Incluir parametros UTM da campanha (slug da landing page)

#### 7. Registro de Lead (Banco de Dados)

Ao clicar em qualquer botao de finalizacao:
- Salvar lead na tabela `lp_leads` com:
  - `name`, `phone`, `campaign_tag: "catalogo-{slug}"`
  - Metadados: lista de produtos, canal escolhido (yampi/whatsapp/loja)
- Incrementar `clicks` na tabela `catalog_landing_pages`

#### 8. Mensagem WhatsApp com Carrinho Completo

Formato da mensagem pre-preenchida:

```
Oi! Sou {NOME}, vim do catalogo Dose Tripla e quero comprar:

1. *Tenis XYZ* - Cor: Branco - Tam 34
2. *Sandalia ABC* - Cor: Preto - Tam 34
3. *Papete DEF* - Cor: Rosa - Tam 34

Total: R$ 300 (combo 3 pares)

Meu WhatsApp: {TELEFONE}
```

### Arquivos a Criar/Editar

| Arquivo | Acao |
|---------|------|
| `src/pages/DoseTriplaCatalog.tsx` | Editar — adicionar estado de carrinho, step "cart", integracao Yampi, formulario de cliente |
| `src/components/marketing/CatalogLandingPageCreator.tsx` | Editar — corrigir layout do dialog (expandir), corrigir grid de produtos, melhorar UX |

### Design Visual do Carrinho

- Botao flutuante: circulo com icone de sacola + badge numerico, cor primaria do tema
- Tela do carrinho: mesmo estilo dos cards atuais (branco arredondado com blur)
- Botoes de finalizacao: mesmas cores dos botoes atuais (verde site, verde whatsapp, roxo loja)
- Campo de nome e WhatsApp: inputs estilizados dentro do card branco
- Aviso de estoque: caixa amarela/amber com icone de alerta

