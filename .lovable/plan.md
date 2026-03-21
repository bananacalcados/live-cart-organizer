

# Diagnóstico: Erro ao Salvar Pedido + Dados Revertendo

## Problema Identificado

Dois problemas combinados:

### 1. Sem tratamento de erro no `handleSubmit`

O `handleSubmit` no `OrderDialogDb.tsx` (linha 388-463) **não tem try/catch**. Quando o `updateOrder` falha (ex: timeout do banco durante disparos em massa), ele lança uma exceção que interrompe todo o fluxo:

```text
Fluxo atual quando updateOrder falha:
  1. updateOrder → ERRO (toast "Erro ao atualizar pedido") → throw
  2. fetchOrdersByEvent → NUNCA EXECUTA
  3. toast.success → NUNCA EXECUTA  
  4. onOpenChange(false) → NUNCA EXECUTA (dialog fica aberto)
  5. resetForm → NUNCA EXECUTA
```

O dialog fica aberto, mas o realtime subscription pode sobrescrever os dados locais com a versão anterior do banco.

### 2. Atualização do cliente desvinculada do pedido

Quando o usuário edita o telefone no pedido, a atualização do customer (linha 403-405) acontece ANTES do `updateOrder`. Se o `updateOrder` falha depois, o telefone pode ter sido salvo no customer mas o usuário vê o toast de erro e acha que nada foi salvo.

## Correção Proposta

### Arquivo: `src/components/OrderDialogDb.tsx`

Envolver o `handleSubmit` em try/catch para que:
- Se `updateOrder` falhar, o erro seja capturado mas o dialog permaneça funcional
- O `fetchOrdersByEvent` execute em um bloco finally ou separado
- Toast de erro mais claro indicando o que falhou

```text
handleSubmit:
  try {
    // atualizar customer (se mudou)
    // atualizar order
    // fetchOrdersByEvent
    // toast.success
    // fechar dialog
  } catch (error) {
    toast.error("Erro ao salvar pedido. Tente novamente.");
    // NÃO fechar o dialog — deixar o usuário tentar de novo
  }
```

### Opcional: Retry automático

Adicionar um retry simples no `updateOrder` do store para lidar com timeouts temporários.

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| `OrderDialogDb.tsx` | Adicionar try/catch no handleSubmit |

## Garantias

- Nenhum outro módulo é afetado
- O fluxo de criação de pedido novo também ganha o try/catch
- Nenhuma mudança no banco de dados
