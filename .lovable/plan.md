# Mostrar as parcelas escolhidas no botão de pagamento

## Alteração
- Na Área de Membros da Live, trocar o texto do botão de cartão de `Pagar R$ total` para `Pagar Nx de R$ valor-da-parcela`.
- Aplicar a mesma nomenclatura no checkout gerado pelo PDV e pelo WhatsApp do PDV.
- Para pagamento em 1x ou débito, mostrar claramente `Pagar à vista R$ valor`.

## Segurança
- Alterar somente o texto visual do botão.
- Preservar integralmente valor cobrado, parcelas enviadas, gateways, validações e confirmação do pagamento.

## Validação
- Conferir que mudar a seleção de parcelas atualiza imediatamente o botão.
- Validar Área de Membros, checkout do PDV/WhatsApp e visual em celular.
- Confirmar que o projeto continua sem erros.
