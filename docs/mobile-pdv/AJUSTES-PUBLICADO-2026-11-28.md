# Ajustes após teste publicado — 28/11/2026

## 1 — Endereço e avisos por etapa
- Causa comprovada em leitura: #20C740A1 e #BB3A74E0 guardam `shipping_address.street` (Rua Pernambuco / Rua Cobe). O celular usava só `address`. Ambos estão antes da Conferência e não têm transportadora definida: não é bloqueio dessas etapas no desktop.
- Desktop não tem um único leitor consistente: ExpOrderEditDialog usa `address` e `payment_details.customer_*`, depois completa pela ficha; customerHydrate reconhece address/address1/logradouro, number/numero, neighborhood/bairro/address2, city/cidade, state/province/uf, cep/zip; trackingMessage reconhece street/address1/logradouro, district e zip_code/zipcode também. A expedição lista address. Nada disso foi alterado no computador.
- Mobile usa a união desses formatos, com endereço manual `address` prevalecendo, depois aliases do pedido, depois metadados do link. Detalhe e cartão usam o mesmo leitor. Não escreve nem corrige o JSON em produção.
- Avisos seguem os guards de edição: nome, CPF inválido apenas se preenchido, endereço/CEP para transportadora já escolhida; frete/rastreio/entregador/custo somente na Conferência. Removidas exigências adicionais de telefone/pagamento do celular.
- 10 testes passaram (6 novos, 4 regressões). Leituras dos dois pedidos reais, sem qualquer gravação. Teste visual final abaixo.

## Escopo e desempenho
## 4 — Conferência e documentos (entrega segura parcial)
- Escolha de envio pelo mesmo ExpShippingFields: opções cadastradas, mototaxista, retirada, valor. Cotação e seleção pelo mesmo ExpFreightQuotePanel / sale-freight-quote, sem cotação automática ao abrir.
- Correção dos dados pelo mesmo ExpOrderEditDialog, agora em tela cheia apenas quando a expedição mobile está montada. Leitor normaliza aliases no objeto de exibição antes de abrir, sem persistência automática.
- Bipagem/outbox, pés/numeração/defeito preservados. Campos de rastreio/link/prazo disponíveis; conclusão pelo mesmo finishExpedition/pos_expedition_transition, trava síncrona adicional de toque e trava de troca. Removido foco que impedia tocar nos campos de frete.
- Emissão pelo mesmo nfe-emitir e hidratação desktop; confirmação explícita, trava síncrona, snapshot/documento preservado na retomada, nenhuma retentativa automática. Não altera emissor/payload/numeração/pagamento.
- Documentos disponíveis no detalhe e na conferência: última NF-e de saída modelo 55, DANFE sem impressão automática; etiquetas já existentes via action=label (ERP 10×15, oficial, A4). Impressão PC continua intacta. Se o provedor entregar DANFE HTML em vez de PDF, abre a mesma visualização existente; conversão real para PDF não foi criada.
- **Comprar/gerar nova pré-postagem ficou fora:** correios-shipment protege duas criações normais com índice único, mas após timeout no POST externo marca a linha erro; próxima tentativa exclui erro e pode comprar novamente sem consultar o resultado anterior. Não há proteção suficiente contra compra incerta. Conforme instrução, nenhum botão novo de compra, nenhuma alteração no servidor e nenhuma compra de teste. Exige autorização separada para corrigir esse caminho compartilhado.
- Transportadoras externas sem etiqueta própria no ERP continuam com rastreio manual, como o desktop. Vincular barcode desconhecido e impressão física não foram ampliados nesta entrega; câmera/checklist existentes preservados.
- Abrir documentos acrescenta 2 consultas leves por pedido (NF-e e pré-postagem); frete carrega cotação anterior e opções/prestadores quando aberto. Sem polling, sem emissões automáticas.

## 3 — Lojas reais
- Tabela tem seis lojas ativas: Loja Centro, Loja Perola, Site/Live (is_simulation=false); Lojas + Live, Site + Centro, Tênis Replica (is_simulation=true).
- Critério já usado nos seletores de produtos do desktop: `is_active=true AND is_simulation=false`. Sem nomes/IDs fixos.
- Consulta mobile de IDs exclui lojas simuladas antes de paginar. Contagens mobile somam o mesmo agregado existente por loja real; consulta do desktop intocada. Eventos só das lojas reais.
- Migração aditiva 0331 somente de leitura, aplicada no servidor. Testes em banco descartável verificam lista e contagens.

## 2 — TROCA
- Mesmo critério e helper do desktop: `trocas_devolucoes.pedido_novo_id`, status diferente de cancelada/concluida, `buildExchangeLocks`. Uma consulta em lote dos 50 pedidos, índice existente, nunca por cartão.
- Etiqueta no cartão, detalhe e conferência; bloqueio visual de conclusão quando a troca aguarda finalização no PDV, além da trava que já existe no servidor.
- Sem alterar pedido ou troca. Testes do helper compartilhado executados sem gravações.

- Desktop, pagamento/checkout, envio de mensagem e follow-ups intocados. Sem publicação e sem polling.
- Abertura de Expedição preserva consultas existentes: lojas + contagens + IDs + vendas + enriquecimentos em lote (itens, vendedores/eventos/fontes quando houver, lojas, atribuições/instâncias) + fotos em lote; até cerca de 13 chamadas conforme os dados. Nenhuma consulta por cartão. Atualização por eventos e botão.