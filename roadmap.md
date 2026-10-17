
- [x] Linhas de etapas na aba Pedidos da Live (Etapa 1)
- [x] Linhas de etapas — Etapa 2 (mover manual para Dúvidas, event_contact_lanes)
- [x] Linhas de etapas — Etapa 3 (Msg Área template/uazapi, links, não lida piscando, busca nas 4 linhas)
- [x] Instagram: token expirado → renovação diária + status no admin (falta usuário colar tokens novos)
- [~] Botão EXCLUIR CONTATO no chat do PDV — código pronto; falta publicar a função `contact-erase` (deploy tool não enxergou a pasta nova)
- [ ] NF-e Lourdes: função `fiscal-recover-by-identifier` pronta; BrasilNFe ObterNotasFiscais retorna 524 — retentar; depois botão de recuperação no painel fiscal + corrigir nfce-retry-pending (não apagar doc antes de reemitir)
- [x] PIX no chat: não duplicar código quando houver botão Copiar, adicionar atalho na lateral da Live e reproduzir o botão no histórico
- [x] Painéis laterais nos chats da Live e do PDV + notas persistentes por cliente
- [x] PDV: fila compacta fixa acima das notas; ocultar notas nas ferramentas; botão voltar; produtos completos no checkout
- [x] PDV: ficha completa em painel lateral e largura original do chat preservada com ferramentas abertas
- [x] Ficha completa padrão à direita no PDV e na Live, com notas persistentes à esquerda no PDV
- [x] Botão de cartão mostra as parcelas escolhidas na Área de Membros e nos checkouts do PDV/WhatsApp
- [x] Registro de acessos aos módulos (aba Acessos em Administração)

- [x] Clientes RFM: ampliar e traduzir os botões dos segmentos e explicar cada classificação

## Pagamento dividido (plano aprovado 23/09)
- [x] Etapa 1 — Base: partes de pagamento, registro seguro de parte aprovada, contas (desconto só no Pix), chave desligada
- [x] Etapa 2 — Checkout da cliente pagando parte por parte (cartão das partes só pelo Mercado Pago por enquanto)
- [x] Etapa 3 — PDV > Online > Link de pagamento
- [x] Etapa 4 — Modal do WhatsApp no PDV
- [x] Etapa 5 — Live (botão nas Ações rápidas; falta "Pago parcialmente" nos cards)
- [x] Etapa 6 — Painéis, relatórios, estorno por parte
- [x] Respostas citadas no WhatsApp da Live: exibir citação recebida, responder mensagem anterior e enviar vínculo por provider
- [x] Link de Atendimento nos Grupos VIP (link por grupo, trava do dia, painel e faixa no chat)

## Expedição — gateways
- [x] Retirar Zorma e Soila da Expedição e invalidar as quatro aprovações sandbox; guard de cache e webhook corrigidos, 13 testes e conferência real concluídos.
- [x] Auditar 612 pedidos e 697 vendas desde 22/09 nas operadoras, sem cobranças ou mensagens; 600 pedidos com aprovação real localizada incluindo partes.
- [ ] Fechar conciliação dos casos não automáticos: dois pedidos manuais, saldo pendente da Neta, dois importados Shopify e diferenças de troca — depende de comprovantes/baixas externas da loja. Estornos/contestação localizados preservados sem reversão automática.
- [x] Destacar gateway pago em cada pedido e adicionar filtro no servidor.
- [x] Ampliar Reduzir valor e conferir a tela sem alterar pedidos (filtro Mercado Pago e abertura do diálogo verificados).

## Ajustes do Overlay da Live
- [x] Adaptar o canvas às fontes OBS e verificar 800x600, 1080x1920 e 540x960.
- [x] Mover o controle para o resumo do evento selecionado e verificar as configurações por evento.
- [x] Posições e larguras arrastáveis, fontes, guias e salvamento independente em config.layout.
- [x] Verificar persistência no overlay real, quebra de texto, restauração e entregar print da edição.

## Roleta ao vivo no Overlay
- [x] Campo "Pagou em até (min)" ao criar roleta
- [x] Lista de quem pode girar + botão Girar ao vivo
- [x] Bloco Roleta no Overlay (texto trocando até o prêmio)
- [x] Prêmio físico vai como brinde no pedido (também pago) e aparece na Expedição
- [x] Prêmios de desconto/frete na Ficha da Live e no chat do PDV

## Correções da fila administrativa de grupos
- [x] Corrigir claim, intervalo persistido, ordem e contagem de tentativas.
- [x] Corrigir erros permanentes, instâncias inativas e espelho no sucesso.
- [x] Corrigir parâmetros/contagens do painel e reenfileiramento.
- [x] Zerar falhas da Whats Carol; testes isolados desfeitos e painel autenticado conferido; cron 200.

- [ ] Automação: duas saídas em Aguardar resposta; verificar sem enviar mensagens reais.
