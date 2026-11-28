# Ajustes após teste publicado — 28/11/2026

## 1 — Endereço e avisos por etapa
- Causa comprovada em leitura: #20C740A1 e #BB3A74E0 guardam `shipping_address.street` (Rua Pernambuco / Rua Cobe). O celular usava só `address`. Ambos estão antes da Conferência e não têm transportadora definida: não é bloqueio dessas etapas no desktop.
- Desktop não tem um único leitor consistente: ExpOrderEditDialog usa `address` e `payment_details.customer_*`, depois completa pela ficha; customerHydrate reconhece address/address1/logradouro, number/numero, neighborhood/bairro/address2, city/cidade, state/province/uf, cep/zip; trackingMessage reconhece street/address1/logradouro, district e zip_code/zipcode também. A expedição lista address. Nada disso foi alterado no computador.
- Mobile usa a união desses formatos, com endereço manual `address` prevalecendo, depois aliases do pedido, depois metadados do link. Detalhe e cartão usam o mesmo leitor. Não escreve nem corrige o JSON em produção.
- Avisos seguem os guards de edição: nome, CPF inválido apenas se preenchido, endereço/CEP para transportadora já escolhida; frete/rastreio/entregador/custo somente na Conferência. Removidas exigências adicionais de telefone/pagamento do celular.
- 10 testes passaram (6 novos, 4 regressões). Leituras dos dois pedidos reais, sem qualquer gravação. Teste visual final abaixo.

## Escopo e desempenho
## 5 — Instagram só Direct
- Migrações 0332/0333 somente de leitura: lista mobile deriva o último Direct, direção e atendimento de mensagens reais. Comentários `💬 Comentário…` (Live/post/Reel/anúncio) e fontes explícitas ig_comment/instagram_comment/live_comment são excluídos. Interações de botão no Direct permanecem.
- Contagem exata de Direct não lido calculada apenas para os 50 registros da página, incluindo arquivo. Não há consulta por mensagem no navegador. Histórico/cursor/atualização de status Instagram usam RPC mobile própria, com mesmas permissões e `quoted_message_id`; WhatsApp/Messenger continuam no leitor anterior.
- Não altera resumo, triggers, envio, arquivo, desktop nem mensagens salvas. Publicação necessária para o novo leitor de histórico; leitura da lista já aplicada no servidor.
- Consulta usa idx_wm_channel_created e índices phone/instância do histórico, sem índice novo nem polling. Plano descartado de consultas laterais para 3.379 conversas levou 722 ms; não foi implantado. Consulta em lote de candidatos Direct: 93,6 ms no EXPLAIN. Caminho WhatsApp preservado sem enriquecimento extra.
- Medições autenticadas da página de 50 na conta principal: 246–524 ms incluindo rede, com variação conforme carga; conta secundária: 53–86 ms. Não é garantia de latência sob carga concorrente. Zero comentários nas 50 prévias e na leitura do Direct testado. Não foram executadas mensagens de teste nem gravações.

## Verificação final e limites
- **1.326 testes em 196 arquivos passaram**, incluindo 7 leitores/avisos de endereço, 4 lojas no PostgreSQL descartável, 5 confirmações/toque duplo/retomada fiscal e 8 Direct/lista/não-lidas/arquivo/cursor/permissão, além das regressões anteriores.
- Navegador autenticado 360×844 e 412×844: lojas reais, ambos pedidos citados com rua no cartão e detalhe, editor preenchido com rua em tela cheia, conferência com dados/envio e documentos, lista Instagram principal sem comentários, sem largura excedente e sem erros de execução.
- Conferência visual identificou e corrigiu checkbox alongado pelo tamanho de toque: caixa visual pequena, área da linha permanece grande. Título do editor preserva espaço para fechar.
- Não testados em aparelho real: câmera/leitor físico, teclado, gravação de áudio e impressora. Não testados: salvar edição, selecionar frete real, emitir NF-e, comprar etiqueta, concluir/despachar pedido real, download de documento real nem evento recebido de Direct com a conversa aberta. Essas operações não foram exercidas em produção; emissão/toque duplo/retomada foram simulados.
- Documento HTML legado não foi convertido em PDF; compra de nova etiqueta bloqueada pelo risco documentado. Não declarar o fluxo completo de compra de etiqueta homologado.
- **Publicação:** alterações das telas, editor e leitor de histórico dependem de publicação do frontend pelo Matthews. Consultas de leitura 0331–0333 já aplicadas. Nenhum site publicado; nenhum interruptor, pagamento, checkout, enviador ou fila alterado.
- Follow-ups continuam no roadmap: validade → lembretes PDV → Fila de disparos. Implantação de envio somente sem live ou nova autorização; nada dessas entregas foi iniciado neste pedido.

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