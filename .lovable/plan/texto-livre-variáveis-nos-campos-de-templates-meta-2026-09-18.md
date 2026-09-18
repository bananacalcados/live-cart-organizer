# Texto livre + variáveis nos campos de templates Meta

## Resultado

Em **Marketing > Automações**, cada variável numerada do template Meta poderá receber uma composição como:

```text
acima de {{compra_minima}}
```

No envio, o sistema transforma isso no valor real, por exemplo: **acima de R$ 90,00**.

## O que será alterado

- Trocar a escolha exclusiva atual por um campo de composição que aceite texto livre e variáveis do sistema no mesmo valor.
- Manter atalhos para inserir as variáveis já existentes, como nome, cashback, compra mínima e validade.
- Mostrar uma prévia clara da composição configurada em cada posição do template.
- Preservar configurações antigas: variáveis simples e textos fixos já salvos continuarão funcionando sem conversão manual.
- Aplicar a substituição composta em todos os caminhos das automações: venda imediata, envios agendados, retomada após botão, públicos e teste do fluxo.

## Validação

- Configurar uma posição como `acima de {{compra_minima}}` e confirmar que o teste recebe o texto com o valor formatado.
- Confirmar que uma posição contendo somente `{{compra_minima}}` continua funcionando.
- Confirmar que texto totalmente fixo continua funcionando.
- Verificar que templates e automações já existentes não mudaram.

## Detalhes técnicos

- O formato salvo continuará sendo texto em `templateVars`, evitando alteração no banco.
- A composição reutilizará os marcadores já resolvidos pelos executores das automações.
- Será criado um pequeno editor reutilizável no construtor, com campo de texto e seletor para inserir marcadores na posição do cursor.
