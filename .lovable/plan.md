# Crossell uazapi e atendimento nos Pagos

## Proposta
Manter o Crossell por template Meta e acrescentar envio manual por blocos pela instância selecionada na conversa aberta, tanto uazapi quanto Meta API. Fazer em duas fases independentes; a Fase 1 dos cards pagos já está aprovada. Sem publicar o site, sem enviar ofertas reais durante testes e sem avançar para a Fase C dos grupos.

**Importante:** uazapi não é a API oficial da Meta. Nenhum intervalo, rodízio de texto ou limite garante proteção contra banimento. Para campanhas de marketing em escala, manter a opção oficial como caminho mais adequado.

Referência: [Política de mensagens do WhatsApp Business](https://business.whatsapp.com/policy). Não haverá etapa obrigatória de convite/aceite no editor. Preservar descadastro e regras reais do provedor: na Meta, a janela de mensagens livres conta da última mensagem da cliente, não da compra nem de uma mensagem enviada pela loja.

## Fase 1 — Atendimento nos cards pagos
- Nova mensagem de cliente coloca o card à esquerda da linha PAGOS, com tag **NÃO LIDA**; entre os não lidos, a mensagem mais recente vem primeiro.
- Abrir a conversa marca como lida, conforme o padrão da live; uma nova mensagem volta a destacar o card.
- Em clientes com vários pedidos, considerar a atividade da conversa do cliente, não apenas o pedido representante.
- Clicar no card abre o mesmo WhatsApp da live. Manter **Ver pedidos** e **Unificar envio** como ações separadas, sem mudar regras de unificação ou endereços.
- Não alterar status pago, dados de cliente, pagamento ou expedição.

## Fase 2 — Crossell por blocos na conversa atual
### Montagem
- Escolha entre **Template Meta** (existente) e **Mensagem por blocos** no Crossell do modal da live.
- Ofertas reutilizáveis com blocos ordenados de texto, fotos, arquivos, áudios, vídeos e botões opcionais, com prévia, edição, remoção e seleção de fotos do catálogo existente.
- Permitir conjunto de imagens em um bloco; enviar os arquivos individuais desse bloco em ordem, pois nem todo provedor oferece álbum em uma única mensagem.
- Mostrar a instância selecionada na conversa e usar exatamente ela no envio: uazapi Pérola, uazapi Centro ou Meta API. Não usar seletor global, instância histórica diferente ou fallback silencioso.

### Fluxo de envio direto
1. A equipe monta ou seleciona os blocos no modal da live e clica no botão **ENVIAR**.
2. Registrar uma execução para a cliente e a instância escolhida naquele clique; enviar o primeiro bloco sem etapa de convite ou aceite.
3. Após concluir um bloco, aguardar um intervalo aleatório independente entre **4 e 15 segundos** antes de iniciar o próximo. Sortear e persistir um novo intervalo para cada transição; não usar sequência cíclica ou escalonamento linear. Sorteios independentes podem repetir um valor, sem criar um padrão programado.
4. Mostrar andamento e permitir cancelar os blocos ainda não enviados. Trocar de conversa durante o envio não muda o destinatário ou a instância da execução já iniciada.
5. Botões de resposta são opcionais e definidos pela equipe; respostas de interesse destacam o card com **INTERESSE EM CROSSELL**, além de **NÃO LIDA**, e colocam a cliente no início dos Pagos. Abrir o chat mostra a oferta associada à resposta.
6. Validar previamente os tipos/tamanhos de mídia e botões aceitos pelo provedor. Não declarar envio concluído quando houver falha ou resultado incerto, nem mandar outra versão automaticamente.
7. Meta API: permitir texto/mídia/botões livres apenas dentro da janela real de 24 horas após mensagem da cliente. Revalidar antes de cada bloco; se fechar, pausar e informar que é necessário usar template aprovado. A data da compra não abre essa janela.

### Proteções contra repetição e excesso
- Reusar os mecanismos de fila existentes; reservar cada envio de forma exclusiva e registrar o resultado de cada bloco.
- O envio é manual, exclusivamente pelo botão ENVIAR; não impor limite de uma oferta por live nem criar follow-up automático para quem não responde.
- Não repetir bloco confirmado nem reiniciar sequência após recarregar a página ou clicar duas vezes.
- Resultado incerto do provedor fica em revisão, sem reenvio automático. Reenvio pela equipe exige confirmação explícita e histórico visível.
- Preservar descadastro e bloqueios para ofertas, sem impedir atendimento humano; validar instância, destinatário e janela Meta antes de cada bloco.
- Reusar as reservas da fila para não duplicar execuções; aplicar o intervalo aleatório de 4–15 s solicitado entre blocos. Não acrescentar tetos diários ou novas restrições de envio manual nesta fase.
- O intervalo é um controle próprio do sistema, não garantia contra banimento nem uma forma de contornar detecção da Meta.
- Disparo automático para todos os pagos fica fora desta fase.

## Consultas e atualização
- Hoje o Crossell faz uma consulta de templates ao abrir e uma chamada à Meta ao selecionar o template; não tem atualização periódica própria. Isso não inclui as consultas já usadas pelo modal de WhatsApp.
- A mudança nos Pagos não deve acrescentar consulta por card ou por mensagem: usar os pedidos já carregados, o resumo indexado das conversas e o aviso de mensagem em tempo real existente.
- Ofertas por blocos: uma busca paginada ao abrir o seletor, sem repetição periódica. Respostas de interesse atualizam pelo aviso em tempo real existente. No envio Meta, consultar evidência indexada da janela no servidor.
- Se a integração exigir consulta adicional de atividade, limitar aos clientes carregados, em lote, e documentar o custo antes de implementar. Não baixar histórico inteiro nem criar novo cron por minuto.

## Detalhes técnicos
- Crossell atual: `src/components/events/EventCrossellDialog.tsx`, envio direto por `meta-whatsapp-send-template`.
- Cards pagos/agrupamento: `src/components/events/EventPaymentCardsBar.tsx`.
- Reusar `liveContactUnread`, o marcador de leitura por evento e `useWaMessageBroadcast`; comparar atividade de todos os pedidos agrupados e usar a instância da conversa.
- Avaliar extensão das estruturas de ofertas/fila existentes antes de criar tabelas. A fila `event-bulk-send` atual é específica de templates Meta, usa pausa de 1,2 s e retentativas: não copiar essa configuração para blocos. Persistir o próximo horário de envio com intervalo sorteado de 4.000–15.000 ms a partir da conclusão do bloco anterior; retomadas preservam esse horário.
- Passar explicitamente a instância selecionada do WhatsApp aberto para o editor e a execução; resolver credenciais e capacidades no servidor, sem usar `useConversationInstance(phone)` como substituto da seleção atual.
- Persistir IDs estáveis da oferta, execução, bloco e resposta do botão; conferir evento, destinatário e instância no recebimento. Consumo atômico evita que callbacks duplicados gerem novo envio ou aviso repetido.
- Preservar `quoted_message_id` e IDs reais do provedor. Não usar IA para identificar cliques ou classificar interesse determinístico.
- Validar sessão/permissão, entradas e acesso ao evento no servidor; escritas de execução protegidas e índices conferidos para novas consultas.

## Testes e entrega
- Testar prioridade de não lidos, leitura, nova mensagem após leitura, dois pedidos pagos e abertura do WhatsApp sem acionar unificação.
- Testar duplicidade de clique/agendamento/callback, descadastro antes e durante sequência, falha incerta e retomada sem repetir blocos enviados.
- Testar concretamente intervalo mínimo de 4.000 ms, máximo de 15.000 ms, novo sorteio por transição e preservação do horário após retomada.
- Testar envio pela instância selecionada (Pérola/Centro/Meta), sem troca silenciosa; Meta com janela aberta/fechada e compra recente sem mensagem recente.
- Conferir montagem/prévia de texto, conjunto de fotos, arquivo, áudio, vídeo e botões opcionais no navegador.
- Envio e clique reais exigem um número de teste autorizado: sem isso, informar explicitamente que entrega e botões reais não foram verificados.
- Entregar cada fase com arquivos alterados, testes e limitações; nenhuma publicação do site.