
## Plano: Correcao de Vendedores Duplicados, Recuperacao de Vendas e Otimizacao

### Diagnostico

Apos investigacao detalhada no banco de dados:

- **Centro**: 77 registros na tabela `pos_sellers` para apenas ~10 vendedoras unicas. Exemplo: "Live Shopping" tem 14 copias, "Emilly Rayane" tem 7 copias.
- **Perola**: 23 registros para ~13 vendedoras unicas, com duplicatas similares.
- **Vendas do Centro**: Todas as vendas existem e estao intactas (20+ vendas). O `seller_id` delas aponta para registros antigos que foram marcados como `is_active: false` quando novas copias foram criadas.
- **Causa raiz**: O edge function `pos-tiny-sellers` cria NOVOS registros ao inves de reutilizar os existentes, porque o mapa `existingByTinyId` so pega o primeiro registro e ignora os demais. Ao marcar todos como `is_active: false` e depois inserir novos, os IDs antigos (referenciados nas vendas) ficam orfaos.
- **Config mostra tudo**: `loadSellers` busca TODOS os registros (ativos e inativos), mostrando 77 linhas riscadas no Centro.

---

### Correcoes

#### 1. Limpeza do Banco de Dados (Dados)

Executar via ferramenta de dados (nao migracao):

**Passo A** - Para cada loja, manter apenas 1 registro por `tiny_seller_id` (o mais antigo, pois e o que as vendas referenciam):

```text
Para cada (store_id, tiny_seller_id):
  - Manter o registro com created_at mais antigo
  - Atualizar seller_id nas pos_sales que apontam para duplicatas
  - Deletar todas as duplicatas
  - Marcar o registro mantido como is_active = true
```

**Passo B** - Verificar que as vendas do Centro agora apontam para seller_ids validos e ativos.

#### 2. Edge Function `pos-tiny-sellers` - Reescrever Logica de Sync

Problemas atuais:
- Cria novos registros ao inves de usar UPSERT
- Nao deleta duplicatas existentes

Nova logica:

```text
1. Buscar vendedores ativos da API Tiny (v2 com token da loja)
2. Buscar TODOS os registros locais da loja
3. Para cada vendedor do Tiny:
   a. Se ja existe registro com mesmo tiny_seller_id -> UPDATE (nome, is_active=true)
   b. Se nao existe -> INSERT
4. Marcar como is_active=false todos os locais que NAO estao no retorno do Tiny
5. DELETAR registros duplicados (mesmo tiny_seller_id, manter so o mais antigo)
```

Alem disso, adicionar constraint UNIQUE em `(store_id, tiny_seller_id)` via migracao para prevenir futuras duplicatas.

#### 3. Frontend `POSConfig.tsx` - Mostrar Apenas Vendedoras Unicas

- `loadSellers`: Filtrar para mostrar apenas vendedoras ATIVAS (nao todas)
- Manter a opcao de desativar via toggle (que faz UPDATE, nao INSERT)
- Remover a exibicao de vendedoras inativas riscadas (lixo visual e de armazenamento)

#### 4. Recuperacao de Vendas do Centro

As vendas ja existem no banco. O problema e apenas visual -- o `seller_id` referenciado esta em um registro `is_active: false`. A limpeza do Passo 1 resolve isso automaticamente ao:
- Re-apontar vendas para o registro "canonico" (mais antigo) de cada vendedora
- Marcar esse registro canonico como ativo

---

### Migracao SQL

Adicionar constraint para prevenir duplicatas futuras:

```text
ALTER TABLE pos_sellers 
  ADD CONSTRAINT pos_sellers_store_tiny_unique 
  UNIQUE (store_id, tiny_seller_id);
```

(Sera executada APOS a limpeza de dados para nao conflitar com duplicatas existentes)

---

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| Dados: `pos_sellers` | Limpeza de duplicatas + re-link de vendas |
| `supabase/functions/pos-tiny-sellers/index.ts` | Reescrever sync com UPSERT + dedup |
| `src/components/pos/POSConfig.tsx` | Mostrar so vendedoras ativas + limpeza visual |
| Migracao SQL | Constraint UNIQUE para prevenir duplicatas |

### Ordem de Execucao

1. Limpeza de dados (dedup + re-link vendas)
2. Migracao SQL (constraint UNIQUE)
3. Reescrever edge function
4. Atualizar frontend
