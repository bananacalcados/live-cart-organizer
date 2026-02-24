

## Plano: Corrigir Limpeza de Pedidos Antigos/Apagados do Tiny

### Problema Raiz

A limpeza atual tenta encontrar pedidos cancelados/despachados no Tiny e cruzar com o banco local. Porém:
- Pedidos **apagados** do Tiny nao aparecem em nenhuma lista de status
- A verificacao individual (pedido por pedido) sofre timeout por erros 429 (rate limit)
- Resultado: pedidos fantasmas ficam presos como "aprovados" para sempre

### Solucao: Logica Invertida

Em vez de buscar "quais pedidos mudaram de status no Tiny", a nova abordagem faz o inverso:

1. Buscar TODOS os pedidos com situacao 3 (aprovados) no Tiny
2. Construir um conjunto de tiny_order_ids validos
3. Qualquer pedido local marcado como "approved" que NAO esteja nesse conjunto sera **apagado** do banco (junto com seus itens)

Isso elimina completamente a necessidade de verificacoes individuais e resolve tanto pedidos cancelados quanto apagados.

### Mudancas Tecnicas

**Arquivo: `supabase/functions/expedition-beta-initial-sync/index.ts`**

1. **Reescrever `passCleanup`** com logica invertida:
   - Buscar pedidos aprovados (situacao=3) do Tiny, paginando ate 10 paginas
   - Construir Set com todos os tiny_order_ids que sao aprovados no Tiny
   - Buscar todos os pedidos locais com `expedition_status = 'approved'`
   - Para cada pedido local cujo `tiny_order_id` NAO esta no Set:
     - Deletar itens da tabela `expedition_beta_order_items`
     - Deletar o pedido da tabela `expedition_beta_orders`
   - Logar quantos pedidos foram removidos e quais tiny_order_ids

2. **Remover a secao de verificacao individual** (linhas 442-474) que causa timeout

3. **Ajustar timeouts**:
   - Cleanup: 30 segundos (so precisa paginar a lista de aprovados, sem detail fetches)
   - Pass 1 (novos aprovados): 45 segundos
   - Pass 2/3: manter como esta

4. **Pass 1 tambem protegido**: ao inserir novos pedidos, verificar se o detail fetch retorna 404 e pular (ja existe mas pode ser melhorado)

### Fluxo Revisado

```text
+------------------------------------------+
|  PASS 0: Cleanup (30s)                   |
|  1. Busca situacao=3 do Tiny (batch)     |
|  2. Compara com approved locais          |
|  3. DELETA os que nao existem no Tiny    |
+------------------------------------------+
           |
+------------------------------------------+
|  PASS 1: Importar novos aprovados (45s)  |
|  Busca situacao=3 e insere novos         |
+------------------------------------------+
           |
+------------------------------------------+
|  PASS 2: Atualizar despachados           |
|  Busca situacao=5,6 e atualiza locais    |
+------------------------------------------+
           |
+------------------------------------------+
|  PASS 3: Atualizar cancelados            |
|  Busca situacao=9 e atualiza locais      |
+------------------------------------------+
```

### Resultado Esperado

- Pedidos apagados do Tiny (como @rosanabifulco) serao removidos do sistema
- Pedidos cancelados no Tiny (como @zildacatrolio) serao removidos do sistema
- Apenas pedidos realmente aprovados (situacao=3) no Tiny permanecerao
- Sem risco de timeout (nenhuma verificacao individual necessaria)
- O numero de aprovados no sistema deve bater com o Tiny (67 pedidos)

