

## Adicionar opcao de Brinde na Venda Online e Conferencia

### 1. Modulo Online (POSOnlineSales.tsx)

Adicionar no carrinho (area de desconto/frete) um toggle "Incluir Brinde?" e, quando ativado, um campo de texto para descrever o brinde (ex: "Meia de presente", "Necessaire rosa").

Mudancas:
- Novos estados: `hasGift` (boolean) e `giftDescription` (string)
- UI: Switch + Input condicional, posicionado abaixo do campo de frete
- Salvar `has_gift` e `gift_description` dentro do campo JSONB `payment_details` da `pos_sales`
- Incluir info do brinde na mensagem WhatsApp gerada

### 2. Conferencia do Pedido (POSOrderVerification.tsx)

Receber a informacao de brinde via props e, quando houver brinde, exibir um checkbox adicional: "Brinde colocado na embalagem" com a descricao do brinde.

Mudancas:
- Novas props: `hasGift?: boolean` e `giftDescription?: string`
- Quando `hasGift === true`, renderizar uma secao extra no checklist com checkbox "Brinde adicionado: {descricao}"
- Incluir `giftChecked` no estado de verificacao
- Ajustar `allVerified` para exigir `giftChecked` quando houver brinde
- Salvar no `verification_data` se o brinde foi conferido

### 3. Integracao - Passar dados do brinde para conferencia

Os componentes que chamam `POSOrderVerification` precisam passar `hasGift` e `giftDescription`. Como esses dados ficam em `payment_details`, basta extrair de la ao carregar a venda.

Arquivo: `src/components/pos/POSSalesView.tsx` (ou onde a conferencia e instanciada)
- Ao montar as props do `POSOrderVerification`, ler `payment_details.has_gift` e `payment_details.gift_description`

### Resumo tecnico

| Arquivo | Mudanca |
|---|---|
| `src/components/pos/POSOnlineSales.tsx` | Switch de brinde + campo descricao, salvar em payment_details |
| `src/components/pos/POSOrderVerification.tsx` | Props de brinde, checkbox "Brinde na embalagem", validacao |
| Componente que instancia verificacao | Passar has_gift/gift_description do payment_details |

Nenhuma alteracao de banco de dados necessaria (usa campo JSONB existente).

