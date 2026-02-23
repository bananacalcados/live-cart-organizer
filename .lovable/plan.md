
# Checkout em 3 Etapas + Dados Persistentes por Cliente

## Problema Atual
Atualmente, os dados de cadastro (nome, CPF, email, endereco) estao vinculados apenas ao `order_id` na tabela `customer_registrations`. Quando um cliente compra novamente, precisa preencher tudo de novo. Alem disso, o checkout e uma pagina unica com todos os campos misturados.

## Visao Geral da Solucao

### 1. Banco de Dados: Vincular dados ao Instagram (customer_id)
- Adicionar coluna `customer_id` na tabela `customer_registrations` (referenciando `customers.id`)
- Criar uma funcao RPC `get_customer_registration_by_instagram` que busca o cadastro mais recente pelo `instagram_handle`
- Isso permite recuperar dados de qualquer cliente que ja comprou, independente do pedido

### 2. Indicador Visual no Card do Pedido (OrderCardDb)
- Ao carregar os pedidos, verificar se o `customer_id` possui registro em `customer_registrations`
- Se sim, exibir um badge verde: "DADOS CADASTRADOS" no card
- Trocar o botao "Copiar Link de Cadastro" por "Criar Pedido Shopify" quando os dados ja existirem
- Manter a opcao de enviar link de confirmacao (com dados pre-preenchidos) para o cliente validar o endereco

### 3. Checkout Transparente em 3 Etapas (estilo Yampi)
Redesign completo da pagina `/checkout/order/:orderId` com layout inspirado no print da Yampi:

**Layout Desktop**: 3 colunas (Etapa atual | Proximas etapas | Resumo da compra)
**Layout Mobile**: Empilhado com resumo colapsavel

**Etapa 1 - Identificacao (1 de 3)**
- Nome completo, E-mail, CPF, WhatsApp
- Botao "IR PARA ENTREGA"
- Ao avancar: salva dados em `customer_registrations` vinculando ao `customer_id`
- Dados ja ficam persistidos mesmo que nao finalize a compra

**Etapa 2 - Entrega (2 de 3)**
- CEP (com auto-preenchimento via ViaCEP), Endereco, Numero, Complemento, Bairro, Cidade, UF
- Botao "IR PARA PAGAMENTO"
- Ao avancar: atualiza o registro com dados de endereco

**Etapa 3 - Pagamento (3 de 3)**
- Abas: PIX | Cartao de Credito (mantendo logica atual do Mercado Pago e Pagar.me)
- Apenas dados de pagamento (cartao ou gerar PIX)
- Finalizacao do pagamento

**Pre-preenchimento automatico**: Se o cliente (pelo `instagram_handle` do pedido) ja tiver dados cadastrados, as etapas 1 e 2 vem preenchidas automaticamente, permitindo correcao se necessario.

### 4. Fluxo de Dados

```text
Cliente abre checkout
       |
       v
Busca customer_registrations pelo customer_id do pedido
       |
   [Encontrou?]
   /         \
 Sim          Nao
  |            |
Pre-preenche  Campos vazios
campos         |
  |            |
  v            v
Etapa 1: Identificacao --> Salva/Atualiza registro
       |
       v
Etapa 2: Endereco --> Atualiza registro
       |
       v
Etapa 3: Pagamento --> Processa e cria pedido Shopify
```

## Detalhes Tecnicos

### Migracao SQL
```sql
-- Adicionar customer_id na tabela customer_registrations
ALTER TABLE customer_registrations ADD COLUMN customer_id uuid REFERENCES customers(id);

-- Criar indice para busca rapida por customer
CREATE INDEX idx_customer_registrations_customer_id ON customer_registrations(customer_id);

-- Funcao para buscar ultimo cadastro por customer_id
CREATE OR REPLACE FUNCTION get_latest_registration_by_customer(p_customer_id uuid)
RETURNS customer_registrations
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM customer_registrations
  WHERE customer_id = p_customer_id
  ORDER BY updated_at DESC
  LIMIT 1;
$$;
```

### Arquivos a Modificar
1. **`src/pages/TransparentCheckout.tsx`** - Redesign completo em 3 etapas com stepper visual, pre-preenchimento de dados e salvamento progressivo
2. **`src/components/OrderCardDb.tsx`** - Adicionar badge "DADOS CADASTRADOS" e botao para criar pedido Shopify direto quando dados existem
3. **`src/components/OrderDialogDb.tsx`** - Mostrar indicador de dados cadastrados no dialogo de edicao
4. **`src/pages/CustomerRegister.tsx`** - Atualizar para tambem vincular `customer_id` ao salvar

### Arquivos Novos
- Nenhum arquivo novo necessario; toda logica fica nos arquivos existentes

### Resumo do Impacto
- Clientes nunca mais precisam preencher dados 2x
- Operadores veem imediatamente quais clientes ja tem cadastro
- Checkout mais limpo e moderno (estilo Yampi em 3 passos)
- Dados salvos progressivamente (etapa por etapa)
- Pre-preenchimento automatico para clientes recorrentes
