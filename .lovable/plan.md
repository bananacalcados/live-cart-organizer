

# Landing Page Catalogo Interativo — Calcados em Dose Tripla (Tamanho 34)

## Visao Geral

Criar uma landing page interativa estilo "typebot" que puxa produtos do tamanho 34 diretamente da Shopify, categoriza-os (Tenis, Salto, Papete, Rasteira, etc.) e oferece 3 botoes de compra por produto: Site, WhatsApp (com round-robin entre 2 lojas) e Loja Fisica. O design seguira o padrao visual ja existente nas landing pages da Banana Calcados (`BananaLanding.tsx`).

## Fluxo do Usuario

```text
+------------------+     +------------------+     +------------------+
| 1. Tela de boas- |---->| 2. Escolher      |---->| 3. Grid de        |
|    vindas com    |     |    categoria:    |     |    produtos do    |
|    info do combo |     |    Tenis, Salto, |     |    tamanho 34     |
|    e precos      |     |    Papete, etc.  |     |    com foto e 3   |
+------------------+     +------------------+     |    botoes de      |
                                                  |    compra         |
                                                  +------------------+
```

**Combo Dose Tripla:**
- 1 par: R$ 150
- 2 pares: R$ 240
- 3 pares: R$ 300
- Ate 6x sem juros no cartao ou 15% cashback no Pix

## Detalhes Tecnicos

### 1. Nova pagina: `src/pages/DoseTriplaCatalog.tsx`

**Step "welcome":**
- Banner visual da campanha com os precos do combo
- Botao "Ver Calcados no 34"

**Step "category":**
- Botoes de categoria em grid: Tenis, Salto, Papete, Rasteira, Sandalia, Todos
- Animacao de transicao suave (mesmo padrao do BananaLanding)

**Step "products":**
- Carrega produtos da Shopify via `fetchProducts()` filtrando variantes que tenham `selectedOptions` com valor "34"
- Filtra por categoria baseado no titulo/tipo do produto (mapeamento simples por palavras-chave)
- Grid de cards de produto com:
  - Foto (da Shopify)
  - Nome do produto + cor
  - Preco
  - 3 botoes:
    - **Comprar no Site**: link para a pagina do produto na Shopify (`https://bananacalcados.com.br/products/{handle}?variant={variantId}`)
    - **Comprar no WhatsApp**: abre link `wa.me/{numero}?text=...` com round-robin entre as 2 lojas e mensagem pre-preenchida com nome + cor do produto
    - **Comprar na Loja Fisica**: abre link `wa.me/{numero}?text=...` com mensagem dizendo que quer retirar na loja + nome/cor do produto

**Botao de voltar** em cada step para navegar entre categorias

### 2. Round-Robin WhatsApp entre 2 Lojas

- Usa os numeros ja cadastrados: Banana Calcados (`+55 33 93618 0084`) e Zoppy (`+55 33 93505-0288`)
  - Ou, se preferir usar numeros especificos das lojas fisicas, basta definir no codigo
- Logica simples: alterna entre loja 1 e loja 2 a cada clique, usando `localStorage` para manter o contador
- Mensagem pre-preenchida: "Oi! Vi o produto *{NOME DO PRODUTO}* na cor *{COR}* no tamanho 34 e quero comprar! Campanha Dose Tripla"

### 3. Rota e Registro

- Rota publica: `/dose-tripla` em `App.tsx`
- Nao exige cadastro previo para navegar (e um catalogo aberto)
- Opcionalmente: ao clicar em "Comprar no WhatsApp", registrar o interesse na tabela `lp_leads` com `campaign_tag: "dose-tripla-34"` e metadados do produto escolhido (para analytics)

### 4. Filtragem de Produtos

A Shopify Storefront API ja retorna todas as variantes com `selectedOptions`. A filtragem sera feita no frontend:

1. Buscar todos os produtos via `fetchProducts(250)`
2. Filtrar apenas produtos que tenham pelo menos 1 variante com `selectedOptions` contendo `{ name: "Tamanho", value: "34" }` (ou "Size" dependendo da config da loja)
3. Categorizar por palavras-chave no titulo: "tenis" -> Tenis, "salto" -> Salto, "papete" -> Papete, etc.

### 5. Arquivos a criar/editar

| Arquivo | Acao |
|---------|------|
| `src/pages/DoseTriplaCatalog.tsx` | Criar - pagina principal do catalogo interativo |
| `src/App.tsx` | Editar - adicionar rota `/dose-tripla` |

### 6. Design Visual

- Mesmo estilo das landing pages existentes: gradiente verde Banana, cards brancos com bordas arredondadas, transicoes suaves
- Mobile-first (max-w-md centralizado)
- Grid de produtos: 2 colunas em mobile
- Botoes de compra com cores distintas:
  - Site: verde (primario)
  - WhatsApp: verde WhatsApp (#25D366)
  - Loja Fisica: azul/roxo

### 7. Dados da campanha embutidos

- Nao precisa de banco de dados novo
- Precos do combo hardcoded na tela de boas-vindas
- Numeros de WhatsApp das lojas hardcoded (podem ser facilmente alterados)
- Categorias de produto definidas como constantes no componente

