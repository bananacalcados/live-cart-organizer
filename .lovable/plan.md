# Plano: Link de Pagamento Avulso (Checkout Transparente)

## Objetivo
No módulo Frente de Caixa → aba Online → "Criar Link de Pagamento", oferecer duas opções:
1. **Criar link de produtos** → fluxo atual (não muda nada).
2. **Criar link avulso** → cobrar um valor sem produto/serviço vinculado e **sem etapa de frete/entrega**.

O link avulso usa o MESMO checkout transparente (`checkout-loja/:storeId/:saleId`) já existente. Nada do fluxo de produtos é alterado.

## Como vai funcionar (visão do usuário)

```text
[Criar Link de Pagamento]
        |
        v
  +-----------------------------+
  | Criar link de produtos      |  -> fluxo de hoje (POSOnlineSales)
  | Criar link avulso           |  -> novo modal
  +-----------------------------+

  Link avulso:
  1) Digita o VALOR em R$
  2) Aparecem 2 botões:
       [Preencher dados]      -> form: nome, CPF, e-mail, telefone,
                                 endereço c/ CEP, forma de pagto (Pix/Cartão)
                                 -> gera link já com dados + copiar/WhatsApp
       [Não preencher dados]  -> gera link só com o valor
                                 -> cliente preenche os próprios dados no checkout
  * Em ambos os casos: SEM escolha de frete/entrega.
```

## Mudanças no código

### 1. Submenu no hub (`src/components/pos/POSOnlineHub.tsx`)
- O botão "Criar Link de Pagamento" passa a abrir um sub-menu com dois cartões: **Criar link de produtos** (abre o atual `POSOnlineSales`) e **Criar link avulso** (abre o novo dialog).
- Acrescentar um novo `mode` (ex.: `"custom-link"`). O modo `"checkout"` atual continua idêntico.

### 2. Novo componente `POSCustomLinkDialog.tsx`
- Campo de **valor (R$)** com máscara de moeda + validação (> 0).
- Dois botões: **Preencher dados** / **Não preencher dados**.
  - **Preencher dados:** formulário com nome, CPF, e-mail, telefone, CEP (auto-preenche endereço via ViaCEP, igual ao checkout), endereço/número/complemento/bairro/cidade/UF e forma de pagamento (Pix ou Cartão). Reaproveita os validadores de CPF/telefone/CEP já existentes.
  - **Não preencher dados:** apenas o valor.
- Ao confirmar, cria a venda e exibe o **link gerado** com botões **Copiar** e **Enviar no WhatsApp** (mesmo padrão visual do dialog de link atual).
- Seletor de vendedora reaproveitado (mesma exigência do fluxo atual).

### 3. Persistência da venda avulsa
- Inserir em `pos_sales` + um único item em `pos_sale_items` representando o avulso (nome "Pagamento avulso", `unit_price` = valor, `quantity` = 1). Usar 1 item sintético mantém toda a matemática de totais/resumo do checkout funcionando sem tocar no cálculo.
- Em `payment_details`, gravar marcador `is_custom_amount: true`, `free_shipping: true`, `shipping_amount: 0`, e os dados do cliente quando preenchidos.
- `total` = valor; `status: "online_pending"`; `sale_type: "online"`.
- Link gerado: `https://checkout.bananacalcados.com.br/checkout-loja/{storeId}/{saleId}` (mesma rota/edge function de hoje).
- **Sem** transferência de estoque (não há SKU) e **sem** push ao Tiny — só ocorrem no fluxo de produtos.

### 4. Checkout transparente (`src/pages/StoreCheckout.tsx`)
- Detectar `payment_details.is_custom_amount === true` ao carregar a venda.
- Quando avulso:
  - **Pular a Etapa 2 (Entrega/Frete)**: do passo 1 (Identificação) vai direto ao passo 3 (Pagamento). `StepIndicator` mostra 2 passos (Identificação → Pagamento).
  - Forçar `free_shipping` e `shipping_amount = 0` (nenhuma cotação de frete é chamada).
  - Resumo do pedido mostra "Pagamento avulso" + valor, sem linha de frete obrigatória.
- Se os dados já vierem preenchidos (opção "Preencher dados"), pré-popular o formulário e, se completos, já abrir direto no passo de Pagamento.
- O fluxo de produtos (sem o marcador) continua exatamente como hoje (3 passos com frete).

## Garantias de não-regressão
- Nenhuma alteração no `POSOnlineSales` (fluxo de produtos), nas edge functions de pagamento (Mercado Pago PIX/cartão) nem no `checkout-public`.
- O comportamento atual do `StoreCheckout` só muda quando o marcador `is_custom_amount` está presente; vendas existentes não têm esse marcador.
- Reuso dos componentes/validadores existentes (mesma UX de copiar link, WhatsApp, ViaCEP, parcelas).

## Detalhes técnicos
- Marcador da venda: `payment_details.is_custom_amount: boolean`.
- Item sintético em `pos_sale_items`: `product_name: "Pagamento avulso"`, `sku: null`, `unit_price = valor`, `quantity: 1`.
- `StoreCheckout`: novo estado derivado `isCustom`; condicionais em `StepIndicator`, na navegação de passos e no `OrderSummary`; bypass da função `quoteFreight`.
- PIX e Cartão usam o `saleId` exatamente como já fazem hoje — sem mudanças nas edge functions.

## Itens a confirmar
- Forma de pagamento no "Preencher dados": deixo o cliente ainda escolher Pix/Cartão na tela final, ou já travo na opção escolhida pela vendedora? (Plano assume: a escolha da vendedora é uma sugestão e a tela final continua permitindo Pix/Cartão, para não quebrar o fluxo de pagamento atual.)
