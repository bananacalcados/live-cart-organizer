
# Sistema de Captacao de Produtos por Codigo de Barras (Pai/Filho)

## Objetivo
Criar um modulo dentro da area de Estoque que permite fotografar/bipar etiquetas de produtos em uma loja parceira, identificar automaticamente a hierarquia Pai (modelo) e Filhos (variacoes por tamanho/cor), montar um catalogo temporario e, ao final, criar os produtos no Tiny ERP com estrutura de variacoes.

## Analise das Etiquetas
Com base nos prints enviados:
- **Codigo do modelo (PAI)**: `UC0602005` - identifica o produto independente de tamanho/cor
- **Nome**: `TENIS CADARCO OURO LIGHT`
- **GTIN (codigo de barras)**: unico por variacao (ex: `7890924449152` = tam 40, `7890924449145` = tam 39)
- **Tamanho**: `40`, `39` (campo BRA)
- **Referencia**: `6003702928` (igual para todas as variacoes)

## Fluxo do Usuario

```text
1. Abrir aba "Captacao" no modulo de Estoque
2. Selecionar a loja destino (onde os produtos serao cadastrados)
3. Bipar o codigo de barras da caixa (camera ou leitor fisico)
4. Sistema registra: GTIN, nome do produto, codigo pai, tamanho
5. Se o codigo pai ja existe na sessao, agrupa como filho
6. Se e um novo codigo pai, cria um novo grupo
7. Permite edicao manual (nome, cor, preco, etc.)
8. Ao finalizar, botao "Criar no Tiny" envia tudo via API
```

## Mudancas Necessarias

### 1. Nova Tabela: `product_capture_sessions`
Sessao de captacao (uma por ida a loja do amigo):
- `id`, `store_id`, `status` (capturing, completed), `notes`, `created_at`

### 2. Nova Tabela: `product_capture_items`
Cada item bipado:
- `id`, `session_id`, `parent_code` (ex: UC0602005), `product_name`, `barcode` (GTIN), `size`, `color`, `price`, `reference_code`, `quantity`, `tiny_product_id` (preenchido apos criar no Tiny), `created_at`

### 3. Nova Aba "Captacao" no Inventory.tsx
Adicionar uma nova aba no modulo de estoque com:
- Botao para iniciar sessao de captacao
- Campo de bipagem (input + camera) que captura o GTIN
- Lista agrupada por `parent_code` mostrando hierarquia Pai > Filhos
- Campos editaveis para nome, cor, preco de cada item
- Contadores: total de modelos (pais), total de variacoes (filhos), total de unidades

### 4. Logica de Agrupamento Automatico
Ao bipar um codigo de barras:
- Buscar na tabela `product_capture_items` da sessao atual por codigos com o mesmo `parent_code`
- Se encontrar, o item e automaticamente agrupado como "filho" do mesmo pai
- O `parent_code` sera extraido da etiqueta (campo tipo UC0602005)
- Como o GTIN nao contem o parent_code diretamente, o usuario informara o parent_code na primeira bipagem de um modelo novo, e para os subsequentes com mesmo parent_code o sistema agrupara automaticamente

**Fluxo inteligente**: Na primeira bipagem de um modelo, o sistema pede o codigo pai (UC0602005) e o nome. Nas proximas bipagens, se o usuario informar o mesmo codigo pai, agrupa automaticamente.

### 5. Nova Edge Function: `tiny-create-product-with-variations`
Recebe os dados agrupados e cria o produto no Tiny ERP usando `produto.incluir.php`:
- `classe_produto: "V"` (com variacoes)
- `codigo`: codigo pai (ex: UC0602005)
- `nome`: nome do produto
- `variacoes[]`: array com cada filho contendo:
  - `codigo`: GTIN ou SKU do filho
  - `grade`: `{ "Tamanho": "40", "Cor": "Ouro Light" }`
  - `estoque_atual`: quantidade contada

### 6. Interface de Revisao Pre-Envio
Antes de criar no Tiny, mostrar:
- Arvore visual: Produto Pai > Filhos (tamanho/cor)
- Campos editaveis para ajustes de ultimo momento
- Botao "Criar no Tiny" com confirmacao
- Feedback de sucesso/erro por produto

## Detalhes Tecnicos

### Tabelas (SQL Migration)
```text
product_capture_sessions:
  - id (uuid PK)
  - store_id (uuid FK pos_stores)
  - status (text default 'capturing')
  - notes (text nullable)
  - created_at (timestamptz)

product_capture_items:
  - id (uuid PK)
  - session_id (uuid FK product_capture_sessions)
  - parent_code (text) -- ex: UC0602005
  - product_name (text)
  - barcode (text) -- GTIN
  - size (text nullable)
  - color (text nullable)
  - price (numeric default 0)
  - reference_code (text nullable) -- ex: 6003702928
  - quantity (integer default 1)
  - tiny_product_id (bigint nullable)
  - created_at (timestamptz)
```

### Edge Function: `tiny-create-product-with-variations`
- Recebe: `{ store_id, parent_code, product_name, items: [{ barcode, size, color, price, quantity }] }`
- Busca o `tiny_token` da loja
- Monta o payload JSON conforme a API do Tiny
- Envia via POST para `produto.incluir.php`
- Salva o `tiny_product_id` retornado nos items
- Responde com sucesso/erro

### UI na Aba Captacao
- Reutilizar o componente `POSBarcodeScanner` existente para camera
- Input de bipagem com suporte a leitor fisico (mesmo padrao do modulo de estoque)
- Cards agrupados por produto pai, expandiveis para ver filhos
- Badge com contagem de variacoes por modelo
- Botao global "Criar Todos no Tiny" + botao individual por produto

### RLS
- As tabelas terao RLS habilitado com politicas permissivas para usuarios autenticados (mesmo padrao das demais tabelas do modulo de estoque)
