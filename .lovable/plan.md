
## Plano: Retirada na Loja (Online), Fechar Seller Gate, Metas, Sugestoes Inteligentes e Experiencia de Fidelidade Gamificada

Este plano cobre 5 grandes areas de melhoria no POS.

---

### 1. Opcao "Retirar na Loja" no Modulo Online

**O que muda:**
- Adicionar um novo gateway "pickup" nos botoes de pagamento do `POSOnlineSales`
- Ao selecionar "Retirar na Loja", o vendedor escolhe em qual loja o cliente vai retirar (seletor com todas as lojas ativas)
- O pedido e salvo em `pos_sales` com `status: "pending_pickup"` e `store_id` da loja de retirada (nao da loja de origem)
- O pedido aparece automaticamente na aba "Retiradas" (`POSPickupOrders`) da loja de destino via subscription Realtime ja existente

**Arquivos:**
- `src/components/pos/POSOnlineSales.tsx` - Adicionar gateway "pickup" com seletor de loja de destino

---

### 2. Fechar a Janela do Seller Gate

**O que muda:**
- Adicionar um botao "X" ou "Fechar" no Dialog do `POSSellerGate` para permitir que o vendedor feche a janela sem selecionar vendedora
- Na `POSSalesView`, quando o seller gate e fechado sem selecao, o componente emite um callback que permite navegar para outras abas

**Arquivos:**
- `src/components/pos/POSSellerGate.tsx` - Adicionar botao de fechar e prop `onClose`
- `src/components/pos/POSSalesView.tsx` - Tratar o `onClose` do SellerGate
- `src/pages/POS.tsx` - Passar callback de navegacao

---

### 3. Sistema de Metas na Configuracao

**Nova tabela: `pos_goals`**

```text
id          uuid PK default gen_random_uuid()
store_id    uuid FK -> pos_stores
goal_type   text (avg_ticket | revenue | seller_revenue | items_sold)
goal_value  numeric
period      text (daily | weekly | monthly)
seller_id   uuid nullable FK -> pos_sellers (null = meta global)
is_active   boolean default true
created_at  timestamptz default now()
updated_at  timestamptz default now()
```

**O que muda:**
- Na aba Config: nova secao "Metas" com formulario para criar metas de ticket medio, faturamento, faturamento por vendedor e itens vendidos
- No Dashboard: comparar KPIs atuais com as metas configuradas, mostrando progresso (barra de progresso + percentual) e alertas visuais
- No Seller Gate: ao selecionar vendedora, mostrar o progresso individual dela em relacao as metas (ex: "Falta R$500 para sua meta de faturamento do dia")

**Arquivos:**
- Migracao SQL para criar `pos_goals`
- `src/components/pos/POSConfig.tsx` - Nova secao de metas
- `src/components/pos/POSDashboard.tsx` - Exibir progresso vs metas
- `src/components/pos/POSSellerGate.tsx` - Mostrar metas individuais

---

### 4. Sugestoes Inteligentes de Cross-Sell na Venda

**Logica de Curva ABC:**
- Curva A: produtos com alta rotacao (top 20% em vendas nos ultimos 90 dias)
- Curva B: rotacao media (proximo 30%)
- Curva C: baixa rotacao (restante 50%)
- Calculado sob demanda com base em `pos_sale_items` agregados

**O que muda:**
Quando a vendedora adiciona um produto ao carrinho:

1. Extrair o tamanho do produto adicionado
2. Buscar produtos no mesmo tamanho com estoque disponivel (`pos_products`)
3. Classificar por curva ABC (baseado em vendas dos ultimos 90 dias)
4. Aplicar regras de desconto:
   - Curva B: ate 15% de desconto
   - Curva C: ate 30% de desconto
   - Curva A tamanho 34 com estoque alto: ate 15% (Curva A), 30% (B), 50% (C)
5. Exibir um painel de sugestoes abaixo do carrinho com produtos recomendados, desconto sugerido e botao "Adicionar ao pedido"
6. Se o ticket medio estiver abaixo da meta, sugerir produtos mais caros

**Arquivos:**
- `src/components/pos/POSSalesView.tsx` - Painel de sugestoes de cross-sell com logica ABC
- Nova funcao auxiliar para calcular curva ABC dos produtos

---

### 5. Experiencia Gamificada de Fidelidade Pos-Venda

**Fluxo redesenhado apos a venda com cliente identificado:**

1. **Tela 1 - Roleta de Pontos (automatica):**
   - A roleta (slot machine) gira AUTOMATICAMENTE sem precisar puxar alavanca
   - Animacao colorida e chamativa mostrando os pontos sendo calculados
   - Mostra "+XX pontos conquistados!"

2. **Tela 2 - Resumo de Pontos Acumulados:**
   - Exibe o total de pontos acumulados do cliente
   - Mostra uma barra de progresso ate o proximo premio
   - Lista os premios disponiveis com quantos pontos faltam para cada um
   - Se o cliente ja tiver pontos suficientes para um premio, destaca com animacao e abre a caixa de presente automaticamente

3. **Tela 3 - Chamada para acao:**
   - Se tem premio disponivel: mostra o premio ganho com codigo
   - Se nao: mostra mensagem motivacional ("Faltam X pontos para ganhar [premio]! Volte em breve!")
   - Botao "Finalizar" fecha o fluxo

**Visual:** Cores vibrantes (amarelo, laranja, verde), emojis, animacoes de confete, fundo com gradiente. Interface pensada para tablet virado para o cliente.

**Arquivos:**
- `src/components/pos/POSSlotMachine.tsx` - Redesenhar para girar automaticamente e ser mais colorido
- `src/components/pos/POSLoyaltyScreen.tsx` - **Novo componente** que orquestra o fluxo completo (pontos -> resumo -> premio)
- `src/components/pos/POSSalesView.tsx` - Substituir a chamada direta do SlotMachine/GiftBox pelo novo `POSLoyaltyScreen`

---

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| Migracao SQL | Criar tabela `pos_goals` |
| `src/components/pos/POSOnlineSales.tsx` | Adicionar opcao "Retirar na Loja" com seletor de loja |
| `src/components/pos/POSSellerGate.tsx` | Adicionar botao fechar + metas individuais |
| `src/components/pos/POSSalesView.tsx` | Tratar onClose do SellerGate + painel cross-sell + novo fluxo loyalty |
| `src/pages/POS.tsx` | Passar callback de navegacao ao POSSalesView |
| `src/components/pos/POSConfig.tsx` | Nova secao de metas |
| `src/components/pos/POSDashboard.tsx` | Progresso vs metas |
| `src/components/pos/POSSlotMachine.tsx` | Auto-spin + visual mais chamativo |
| `src/components/pos/POSLoyaltyScreen.tsx` | **Novo** - Fluxo completo de fidelidade pos-venda |
