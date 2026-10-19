
- [x] Linhas de etapas na aba Pedidos da Live (Etapa 1)
- [x] Linhas de etapas — Etapa 2 (mover manual para Dúvidas, event_contact_lanes)
- [x] Linhas de etapas — Etapa 3 (Msg Área template/uazapi, links, não lida piscando, busca nas 4 linhas)
- [x] Instagram: token expirado → renovação diária + status no admin (falta usuário colar tokens novos)
- [~] Botão EXCLUIR CONTATO no chat do PDV — código pronto; falta publicar a função `contact-erase` (deploy tool não enxergou a pasta nova)
- [ ] NF-e Lourdes: função `fiscal-recover-by-identifier` pronta; BrasilNFe ObterNotasFiscais retorna 524 — retentar; depois botão de recuperação no painel fiscal + corrigir nfce-retry-pending (não apagar doc antes de reemitir)
- [x] PIX no chat: adicionar atalho na lateral da Live e reproduzir o botão no histórico
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

## Correção de pagamento em 10x
- [x] Corrigir filtro do MP que removia 10x fixadas; 12 testes e clique no navegador com retorno simulado de 6x mantiveram 10x e valor combinado, sem cobrança real.

## Ajustes do Overlay da Live
- [x] Preservar parcelas escolhidas pela equipe na área de membros e impedir nova seleção; 9 testes passaram, tela com dados interceptados manteve 10x após editar o cartão; sem cobrança real.
- [x] Corrigir escolha de parcelas no celular e texto do botão após editar o cartão; 3 testes passaram, troca 3x→6x e botão conferidos em celular/desktop sem cobrança.
- [x] Adaptar o canvas às fontes OBS e verificar 800x600, 1080x1920 e 540x960.
- [x] Mover o controle para o resumo do evento selecionado e verificar as configurações por evento.
- [x] Posições e larguras arrastáveis, fontes, guias e salvamento independente em config.layout.
- [x] Verificar persistência no overlay real, quebra de texto, restauração e entregar print da edição.
- [x] Aumentar o texto de todos os blocos (faixa 76, barra 72, aviso 72, chamada 84, roleta 108) e reposicionar para nenhum bloco cobrir o outro; aplicado nas 3 lives e no modelo padrão, combinações conferidas no navegador.

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

- [x] Automação: duas saídas em Aguardar resposta; 8 testes passaram e escolha/reabertura conferidas em sessão autorizada com gravações interceptadas, sem envios reais.
- [x] Otimizar recuperação de comentários na conta da live; 3 testes passaram e comentário real apareceu sem recarga (20 s após comentário).
- [ ] Restabelecer chegada imediata dos comentários da Meta: entregas do webhook interrompidas; recuperação do servidor permanece ativa.

## Overlay — relógio, liberação de par e sorteio com prazos (live 19/10, não publicar)
- [x] Bloco 0 — auditoria
- [x] Bloco 1 — relógios de pagamento + aviso "Liberou o par" (testado com dados de mentira e teste desfeito no evento Teste)
- [ ] Bloco 2 — prazos de cadastro/pagamento no sorteio + aba Participantes (aguarda ok do usuário)
- [ ] Bloco 3 — frase de pedido no modelo padrão da faixa

- [x] PIX: substituir botão nativo por instrução + mesmo código isolado; 8 testes com envio simulado, sem cobranças. Não publicado; cópia no WhatsApp real não verificada.
- [x] Corrigir atualização dos carrinhos nas linhas: conferência paginada por minuto, somente detalhes alterados; 5 testes e recuperação de carrinho real em tela desatualizada verificados, sem alterações no banco ou publicação.

## Correção pequena — fotos nos Grupos VIP
- [ ] Preservar legenda dos rascunhos sem mídia: exibição, primeiro arquivo, remoção, link e salvamento; testar sem envios/publicação.
- [x] Novas fotos usam título cadastrado; normalização no insert cobre escritores externos; 20 nomes corrigidos em rascunhos incluindo irmãos agrupados, zero restantes. Teste de inserção na campanha Teste desfeito; legenda e horário preservados.
- [x] Conferidos worker e rotas uazapi/WaSender/Z-API/legado: media_brief nunca é enviado, nem como legenda alternativa. Nenhum envio alterado, sem publicação; tela sem erros.
