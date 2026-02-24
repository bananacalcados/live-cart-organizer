

## Plano: Pagamento na Entrega + Busca/Cadastro de Cliente

### O que muda

Adicionar ao modulo "Venda Online" duas funcionalidades que faltam:

**1. Busca e Cadastro de Cliente**
- Substituir os campos soltos de nome/telefone por um mini-sistema de busca
- Campo de busca por CPF, nome ou WhatsApp que consulta `pos_customers`
- Se encontrar: preenche automaticamente nome, telefone e vincula o `customer_id` na venda
- Se nao encontrar: botao "Novo Cliente" que abre o `POSCustomerForm` ja existente
- Ao salvar o cadastro, vincula automaticamente ao carrinho

**2. Botao "Pagamento na Entrega"**
- Novo gateway ao lado de Yampi/Checkout/PayPal/PIX
- Ao clicar, abre um mini-dialog pedindo:
  - Metodo: **Dinheiro** ou **Maquininha** (toggle/radio)
  - Observacoes (opcional)
- Nao gera link de pagamento (nao precisa)
- Salva a venda em `pos_sales` com:
  - `payment_gateway = 'delivery_cash'` ou `'delivery_card'`
  - `status = 'online_pending'` (aguardando entrega)
  - `payment_link = null`
- Faz a transferencia de estoque normalmente (Loja -> Site)
- Exibe confirmacao com botao de enviar resumo via WhatsApp

### Mudancas Tecnicas

**Arquivo: `src/components/pos/POSOnlineSales.tsx`**

1. **Importar `POSCustomerForm`** e adicionar estados para busca de cliente:
   - `customerSearch` (termo de busca)
   - `foundCustomer` (cliente encontrado ou null)
   - `showCustomerForm` (abrir dialog de cadastro)
   - `linkedCustomerId` (uuid do cliente vinculado)

2. **Substituir campos de nome/telefone** por:
   - Input de busca (CPF/nome/WhatsApp)
   - Ao digitar 3+ caracteres, busca em `pos_customers`
   - Lista de resultados clicaveis (max 3)
   - Botao "Novo Cliente" que abre `POSCustomerForm`
   - Quando cliente selecionado/criado: mostra card com nome + telefone + botao "X" pra desvincular

3. **Expandir tipo Gateway**:
   - Adicionar `"delivery"` ao tipo `Gateway`
   - Novo botao "Na Entrega" com icone de caminhao (Truck), cor laranja

4. **Fluxo "Na Entrega"**:
   - Ao clicar "Na Entrega", abre um pequeno dialog/popover inline
   - Opcoes: "Dinheiro" e "Maquininha" (dois botoes radio)
   - Botao confirmar
   - Salva venda com `payment_gateway = 'delivery_cash'` ou `'delivery_card'`
   - Nao gera link, vai direto pra tela de confirmacao
   - Tela de confirmacao mostra resumo + botao WhatsApp com mensagem customizada:
     *"Ola! Seu pedido foi separado. Valor total: R$ XX. Pagamento na entrega (dinheiro/cartao)."*

5. **Salvar `customer_id` na venda**: adicionar campo `customer_id` ao insert de `pos_sales`

**Migracao SQL**: Adicionar coluna `customer_id` (uuid, nullable, FK pos_customers) em `pos_sales` caso nao exista, e coluna `payment_method_detail` (text, nullable) para guardar "cash" ou "card" no pagamento na entrega.

### Fluxo Visual

```text
+----------------------------------+
|  BUSCA CLIENTE                   |
|  [____CPF/Nome/WhatsApp____] [+] |
|                                  |
|  > Maria Silva - 11999...        |
|  > Joao Santos - 21988...        |
|  [+ Novo Cliente]                |
+----------------------------------+
|  Cliente: Maria Silva  [X]       |
|  WhatsApp: 11999887766           |
+----------------------------------+

+----------------------------------+
|  GATEWAYS                        |
|  [Yampi] [Checkout] [PayPal]     |
|  [PIX]   [Na Entrega]           |
+----------------------------------+

Se "Na Entrega":
+----------------------------------+
|  Como sera o pagamento?          |
|  (o) Dinheiro  (o) Maquininha    |
|  [Confirmar Venda]               |
+----------------------------------+
```

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| `src/components/pos/POSOnlineSales.tsx` | Editar (busca cliente + gateway entrega) |
| Migracao SQL | Adicionar `customer_id` e `payment_method_detail` em `pos_sales` |
