# Aba "Lista de Compras" na Expedição do PDV

## O que a equipe vai ver

Nova aba **Lista de Compras** em PDV > Expedição, ao lado das abas atuais.

### 1. Grades (tipos de grade)
- Botão **Gerenciar grades**: criar, editar e desativar grades.
- Cada grade tem **nome** (ex.: "Grade Feminina 34-39") e os **tamanhos com quantidade por tamanho** (ex.: 34×1, 35×2, 36×3, 37×3, 38×2, 39×1 = 12 pares).
- Grade desativada some da escolha, mas os pedidos antigos continuam mostrando a grade como foi pedida.

### 2. Adicionar produtos à lista
- Botão **Adicionar** abre uma janela com a lista de **produtos pais**, com busca no servidor por código interno, nome, cor ou marca (paginada, 50 por vez).
- Dá pra marcar **vários produtos de uma vez**. Para cada marcado: escolher a **grade** e a **quantidade de grades**, com campo de observação opcional.
- Mostra o total de pares de cada linha (grades × pares da grade).
- **Confirmar** cria uma solicitação com a **data/hora e quem pediu**.

### 3. Lista de solicitações
- Lista agrupada por solicitação (data mais recente no topo), cada linha mostra: foto, código, nome, cor, grade, quantidade de grades, total de pares, status.
- Filtros: **Pendentes / Comprados / Todos** e busca.
- Por produto:
  - **CONFIRMAR PEDIDO** — marca como comprado (registra data e quem confirmou), com campo opcional de previsão de chegada. Status passa a "Comprado — vai chegar na loja". Dá pra desfazer.
  - **+ Grades** — aumentar a quantidade de grades depois de solicitado (também funciona depois de confirmado; fica registrado o histórico de aumentos com data e quem fez).
  - Remover item (só enquanto pendente).

## Fora do escopo (desta fase)
- Não mexe no estoque nem dá entrada automática quando chegar.
- Não altera a lista de "Grades compradas / chegadas" que já existe na Separação.
- Sem custo/fornecedor por enquanto (dá pra incluir depois, se quiser).

## Detalhes técnicos
- Tabelas novas (com permissões e RLS para equipe logada):
  - `purchase_grade_types` (nome, ativo) + `purchase_grade_type_sizes` (tamanho, quantidade, ordem).
  - `purchase_requests` (criada em, criada por).
  - `purchase_request_items` (produto pai, grade, snapshot dos tamanhos da grade, qtd. de grades, status pendente/comprado, confirmado em/por, previsão de chegada, observação).
  - `purchase_request_item_changes` (histórico de aumento de grades).
- Produtos pais vêm do catálogo existente, com busca no servidor via índice já existente (conferir com EXPLAIN); nada de baixar a lista inteira.
- Confirmar e aumentar grades via funções no servidor (atômicas, registram quem fez).
- Ao abrir a aba: 1 consulta para a lista (paginada) + 1 para as grades; sem polling, recarrega após cada ação.
- Componentes novos em `src/components/pos/expedition/` (ExpPurchaseListTab, grade manager, diálogo de adicionar), registrados em POSExpedition.
- Testes para: total de pares = grades × pares da grade; aumento de grades soma e registra histórico; item confirmado não pode ser removido.

## Dúvidas pra confirmar
1. "Produto pai" = produto sem separar por cor, ou um por cor (código tipo T101)? Plano assume **um por cor** (é o que tem código interno).
2. A lista é única para todas as lojas ou separada por loja?
