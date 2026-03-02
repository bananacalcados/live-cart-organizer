
# Criar Webhook da VINDI/Yapay

## Situacao Atual

A funcao `chargeVindi` dentro de `pagarme-create-charge` ja envia o campo `url_notification` apontando para:
```
{SUPABASE_URL}/functions/v1/payment-webhook?gateway=vindi
```

Porem, a edge function `payment-webhook` **nao existe** neste projeto. Isso significa que quando a VINDI/Yapay envia notificacoes de mudanca de status (aprovacao, cancelamento, etc.), elas sao perdidas.

## O que sera feito

Criar a edge function `payment-webhook` adaptada para este projeto, que:

1. **Recebe notificacoes da VINDI/Yapay** via POST com `?gateway=vindi`
2. **Consulta a API da Yapay** para validar o status real da transacao (usando `token_transaction` e `VINDI_API_KEY`)
3. **Atualiza `orders` ou `pos_sales`** conforme o status:
   - Status 6 (Aprovada) ou 87 (Em Monitoramento) -> marca como pago
   - Status 7, 13, 14, 88, 89 (Cancelada/Estornada/Rejeitada/Fraude) -> marca como falha
4. **Registra log em `pos_checkout_attempts`** para rastreabilidade no monitor de checkout

A funcao tambem suportara os gateways `pagarme` e `appmax` como rota unificada, evitando duplicacao com os webhooks existentes (que continuam funcionando independentemente).

## Detalhes Tecnicos

### Arquivo novo
- `supabase/functions/payment-webhook/index.ts`

### Configuracao
- Adicionar `[functions.payment-webhook]` com `verify_jwt = false` no `config.toml` (automatico pelo deploy)

### Logica VINDI/Yapay
A VINDI pode enviar o payload como JSON ou form-urlencoded. A funcao tentara parsear ambos formatos para extrair o `token_transaction` e `status_id`. Em seguida, consulta a API da Yapay para confirmar o status antes de atualizar o banco.

### Mapeamento de status VINDI/Yapay
```text
6  = Aprovada         -> marca como pago
87 = Em Monitoramento -> marca como pago
7  = Cancelada        -> marca como falha
13 = Cancelamento Manual -> marca como falha
14 = Estornada        -> marca como falha
88 = Rejeitada        -> marca como falha
89 = Fraude           -> marca como falha
```

### Fluxo de atualizacao
1. Tenta localizar o pedido em `orders` (pelo `token_transaction` nas `notes`)
2. Se nao encontrar, tenta em `pos_sales`
3. Atualiza status e registra em `pos_checkout_attempts`

### Nenhuma mudanca no banco de dados
A funcao usa tabelas ja existentes (`orders`, `pos_sales`, `pos_checkout_attempts`).
