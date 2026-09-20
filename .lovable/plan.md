# Parcelamento por link (e por live), com ou sem acréscimo

## Diagnóstico — por que hoje aparece 10x sem juros em tudo

Auditei toda a integração com o Mercado Pago. Três coisas explicam o problema:

1. **A configuração da Live só serve para LIBERAR parcelas, nunca para limitar.** No checkout, o valor do evento é combinado com o padrão pegando sempre o maior número. Ou seja: se o padrão é 12 e a live diz 6, vale 12. E quando a compra fica abaixo do valor mínimo da live, ela simplesmente não aplica nada e cai no padrão.
2. **O padrão geral do sistema é 12 parcelas.** Ele nunca foi apertado, porque até agora quem segurava era o Mercado Pago (só tinha sem juros até 6).
3. **Quem decide "sem juros" hoje é o Mercado Pago, não nós.** Na hora do pagamento o checkout pergunta ao Mercado Pago as condições reais do cartão. Como a conta agora absorve juros até 10x, ele responde "10x sem juros" e nós mostramos exatamente isso.

**Sobre forçar o Mercado Pago a obedecer nossa regra:** não dá. A configuração de "10x sem juros" é da conta inteira, e no modelo de pagamento que usamos (transparente, cobrança direta) não existe campo para limitar parcelas ou desligar o "sem juros" por venda — esses campos só existem no checkout hospedado do próprio Mercado Pago, que não usamos e não vale trocar. Então a trava tem que ser nossa: nós controlamos quais parcelas o cliente vê e qual valor é cobrado. Isso é totalmente viável e é o que o plano faz.

## O que vou construir

### 1. Regra de parcelamento por link (substitui o padrão, não soma)

Cada link de pagamento passa a carregar sua própria regra:

- **Máximo de parcelas** (1 a 12)
- **Parcelas sem juros** (0 = tudo com acréscimo; 3 = até 3x sem juros e o resto com acréscimo)
- **Juros ao mês** do acréscimo (padrão 2,49%, editável no link)
- **Valor mínimo por parcela** (opcional — abaixo disso a opção some da lista)

Mudança central: quando o link tem regra, ela **substitui** o padrão geral. Hoje ela só consegue aumentar; passa a poder apertar também.

### 2. Acréscimo mesmo quando o Mercado Pago daria sem juros

Para as parcelas acima do "sem juros" do link, o checkout ignora o "sem juros" do Mercado Pago e cobra o valor com acréscimo da nossa tabela, mostrando no botão o total real ("6x de R$ X — total R$ Y com acréscimo"). Nas parcelas dentro do "sem juros", nada muda: cobra o total cheio, sem acréscimo.

### 3. Trava no servidor

Na hora de cobrar o cartão, o servidor recalcula a regra do pedido e recusa parcelas acima do teto. Assim ninguém burla mexendo na tela.

### 4. Onde configurar

- **Link do checkout no chat do WhatsApp (PDV)**: campos de máximo de parcelas, sem juros até, e juros do acréscimo, na mesma tela onde hoje já existe "parcelas sem juros".
- **Vendas online do PDV**: mesmos campos.
- **Live/Evento**: a configuração que já existe passa a funcionar de verdade como teto, com a opção "acima de R$ X libera até Nx sem juros" mantida como exceção.
- **Padrão geral**: continua existindo para quem não configurar nada no link — vou deixá-lo em 6x sem juros / 12x com acréscimo, como era antes de mexer no Mercado Pago.

## O que não muda

Valor do pedido, Pix, boleto, cascata de gateways, confirmação de pagamento, cashback e emissão fiscal seguem iguais.

## Validação

- Gerar um link com "3x, tudo com acréscimo" e conferir que o checkout mostra só até 3x e com o total aumentado.
- Gerar um link sem configurar nada e conferir que segue o padrão.
- Conferir na Live que um pedido abaixo do valor mínimo não vê as 10x.
- Pagar um cartão de teste em 2x com acréscimo e conferir o valor cobrado no Mercado Pago.
