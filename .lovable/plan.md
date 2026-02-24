
## Plano: Correcoes e Melhorias no POS (Pontos, Cross-Sell, Metas, Fidelidade)

Este plano cobre 5 areas de correcao e melhoria identificadas.

---

### 1. Pontos de Fidelidade Zerados na Tela (Bug Fix)

**Problema:** A tabela `customer_loyalty_points` ja existe e salva os pontos corretamente. Porem, no codigo (`POSSalesView.tsx` linha 689), o `setLoyaltyTotalPoints(newTotal)` so e chamado quando o cliente ja existe. Para clientes novos (primeira compra), o total fica em 0 no estado.

**Correcao:**
- Adicionar `setLoyaltyTotalPoints(points)` no branch de novo cliente (linha ~704)
- Mostrar o nome do cliente na tela da slot machine (`POSSlotMachine.tsx`) - adicionar prop `customerName`

---

### 2. Resgate de Premio Opcional (Resgatar Agora vs Depois)

**Problema:** Atualmente, quando o cliente atinge pontos suficientes para um premio, o sistema automaticamente deduz os pontos e gera o cupom (linhas 718-755 do `POSSalesView`). O usuario quer que o resgate seja **opcional**.

**Correcao:**
- No `POSSalesView.tsx`: ao detectar premio elegivel, **NAO** deduzir pontos nem gerar cupom automaticamente. Apenas marcar o `wonPrize` para exibicao
- No `POSLoyaltyScreen.tsx`: na tela de resumo, quando existe premio elegivel, mostrar dois botoes:
  - "Resgatar Agora" -> abre a caixa de presente, deduz pontos, gera cupom
  - "Guardar para Depois" -> fecha a tela sem deduzir pontos
- Passar callback `onRedeemPrize` para o `POSLoyaltyScreen` que executa a logica de deducao e geracao de cupom

---

### 3. Sugestoes Inteligentes Nao Funcionando (Bug Fix)

**Problema identificado:** O campo `size` esta preenchido com valores como "Bege/Azul", "45", "Salvia" (cores misturadas com tamanhos) e muitos produtos tem `size = NULL`. O filtro `.in("size", cartSizes)` falha quando `cartSizes` esta vazio (produtos no carrinho sem campo size). Alem disso, `tiny_sales_history` esta vazio (sync nunca rodou), entao a curva ABC nao tem dados.

**Correcao no `POSCrossSellSuggestions.tsx`:**
- Remover dependencia exclusiva de `size` - se `cartSizes` estiver vazio, buscar produtos por **categoria** ou simplesmente produtos com alto estoque sem vendas
- Adicionar fallback: quando nao ha dados de ABC (nem Tiny nem POS), sugerir produtos com **maior estoque** (estoque parado = oportunidade)
- Buscar produtos que NAO estao no `tiny_sales_history` (dead stock) como sugestoes prioritarias
- Quando nao tem tamanho, sugerir qualquer produto com estoque alto que nao esteja no carrinho

---

### 4. Sistema de Metas Expandido

**Novas funcionalidades na tabela `pos_goals`:**

Adicionar colunas via migracao:

```text
goal_category   text nullable   -- categoria do Tiny (ex: "tenis masculino")
goal_brand      text nullable   -- marca (ex: "Nike")
period_start    date nullable   -- data inicio do periodo customizado
period_end      date nullable   -- data fim do periodo customizado
prize_label     text nullable   -- descricao do premio (ex: "Bonus de R$100")
prize_value     numeric nullable -- valor do premio/comissao
prize_type      text nullable   -- tipo (bonus, commission_percent, gift)
```

**Novos tipos de meta:**
- `category_units`: vender X pares de uma categoria do Tiny
- `brand_units`: vender X pares de uma marca

**Novos periodos:**
- `custom`: periodo com data inicio e fim especificas
- Meses do ano como opcoes pre-definidas (Marco 2026, Abril 2026, etc.)

**Rastreamento automatico:**
- Na funcao `finalizeSale` do `POSSalesView`, apos salvar a venda, verificar se existem metas de categoria/marca ativas
- Comparar os itens vendidos com as categorias/marcas das metas
- Registrar progresso em uma nova tabela `pos_goal_progress`:

```text
id          uuid PK
goal_id     uuid FK -> pos_goals
seller_id   uuid nullable FK -> pos_sellers
current_value  numeric default 0
last_sale_id   uuid nullable
updated_at  timestamptz
```

**No Dashboard:**
- Exibir metas de categoria/marca com progresso
- Mostrar "FALTA X PARA VOCE GANHAR SEU PREMIO Y (NOME DO VENDEDOR)" em destaque
- Historico de metas passadas continua visivel

**Na Config:**
- Novos campos no dialog de metas: categoria, marca, datas customizadas, premio/comissao
- Carregar categorias do Tiny (`tiny_categories` ou `pos_products`) para seletor

**Arquivos modificados:**
- Migracao SQL: adicionar colunas em `pos_goals` + criar `pos_goal_progress`
- `src/components/pos/POSConfig.tsx`: expandir formulario de metas
- `src/components/pos/POSGoalProgress.tsx`: exibir metas de categoria/marca + mensagem motivacional com premio
- `src/components/pos/POSSalesView.tsx`: ao finalizar venda, atualizar progresso das metas
- `src/components/pos/POSDashboard.tsx`: exibir mensagem de premio pendente

---

### 5. Nome do Cliente na Slot Machine

**Correcao:**
- `POSSlotMachine.tsx`: adicionar prop `customerName` e exibir "Parabens, [NOME]!" no titulo

---

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| Migracao SQL | Expandir `pos_goals` + criar `pos_goal_progress` |
| `src/components/pos/POSSalesView.tsx` | Fix pontos zerados + resgate opcional + tracking de metas |
| `src/components/pos/POSLoyaltyScreen.tsx` | Botoes "Resgatar Agora" vs "Guardar para Depois" |
| `src/components/pos/POSSlotMachine.tsx` | Adicionar nome do cliente |
| `src/components/pos/POSCrossSellSuggestions.tsx` | Remover dependencia de size, fallback por estoque |
| `src/components/pos/POSConfig.tsx` | Expandir metas com categoria, marca, datas, premio |
| `src/components/pos/POSGoalProgress.tsx` | Metas de categoria/marca + mensagem de premio |
| `src/components/pos/POSDashboard.tsx` | Mensagem motivacional de premio |

### Ordem de Implementacao

1. Migracao SQL (pos_goals + pos_goal_progress)
2. Bug fixes rapidos: pontos zerados, nome na slot machine
3. Resgate opcional de premios
4. Fix cross-sell suggestions
5. Sistema de metas expandido (config + dashboard + tracking)
