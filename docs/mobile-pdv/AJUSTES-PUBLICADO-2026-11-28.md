# Ajustes após teste publicado — 28/11/2026

## 1 — Endereço e avisos por etapa
- Causa comprovada em leitura: #20C740A1 e #BB3A74E0 guardam `shipping_address.street` (Rua Pernambuco / Rua Cobe). O celular usava só `address`. Ambos estão antes da Conferência e não têm transportadora definida: não é bloqueio dessas etapas no desktop.
- Desktop não tem um único leitor consistente: ExpOrderEditDialog usa `address` e `payment_details.customer_*`, depois completa pela ficha; customerHydrate reconhece address/address1/logradouro, number/numero, neighborhood/bairro/address2, city/cidade, state/province/uf, cep/zip; trackingMessage reconhece street/address1/logradouro, district e zip_code/zipcode também. A expedição lista address. Nada disso foi alterado no computador.
- Mobile usa a união desses formatos, com endereço manual `address` prevalecendo, depois aliases do pedido, depois metadados do link. Detalhe e cartão usam o mesmo leitor. Não escreve nem corrige o JSON em produção.
- Avisos seguem os guards de edição: nome, CPF inválido apenas se preenchido, endereço/CEP para transportadora já escolhida; frete/rastreio/entregador/custo somente na Conferência. Removidas exigências adicionais de telefone/pagamento do celular.
- 10 testes passaram (6 novos, 4 regressões). Leituras dos dois pedidos reais, sem qualquer gravação. Teste visual final abaixo.

## Escopo e desempenho
## 2 — TROCA
- Mesmo critério e helper do desktop: `trocas_devolucoes.pedido_novo_id`, status diferente de cancelada/concluida, `buildExchangeLocks`. Uma consulta em lote dos 50 pedidos, índice existente, nunca por cartão.
- Etiqueta no cartão, detalhe e conferência; bloqueio visual de conclusão quando a troca aguarda finalização no PDV, além da trava que já existe no servidor.
- Sem alterar pedido ou troca. Testes do helper compartilhado executados sem gravações.

- Desktop, pagamento/checkout, envio de mensagem e follow-ups intocados. Sem publicação e sem polling.
- Abertura de Expedição preserva consultas existentes: lojas + contagens + IDs + vendas + enriquecimentos em lote (itens, vendedores/eventos/fontes quando houver, lojas, atribuições/instâncias) + fotos em lote; até cerca de 13 chamadas conforme os dados. Nenhuma consulta por cartão. Atualização por eventos e botão.