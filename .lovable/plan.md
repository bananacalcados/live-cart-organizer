# Crossell uazapi e atendimento nos Pagos

## Proposta
Manter o Crossell por template Meta e acrescentar uma opção de WhatsApp Business pela uazapi. Fazer em duas fases independentes, sem publicar o site, sem enviar ofertas reais durante testes e sem avançar para a Fase C dos grupos.

**Importante:** uazapi não é a API oficial da Meta. Nenhum intervalo, rodízio de texto ou limite garante proteção contra banimento. Para campanhas de marketing em escala, manter a opção oficial como caminho mais adequado.

Referência: [Política de mensagens do WhatsApp Business](https://business.whatsapp.com/policy). Consentimento e respeito ao descadastro continuam necessários; limites internos não substituem essas regras.

## Fase 1 — Atendimento nos cards pagos
- Nova mensagem de cliente coloca o card à esquerda da linha PAGOS, com tag **NÃO LIDA**; entre os não lidos, a mensagem mais recente vem primeiro.
- Abrir a conversa marca como lida, conforme o padrão da live; uma nova mensagem volta a destacar o card.
- Em clientes com vários pedidos, considerar a atividade da conversa do cliente, não apenas o pedido representante.
- Clicar no card abre o mesmo WhatsApp da live. Manter **Ver pedidos** e **Unificar envio** como ações separadas, sem mudar regras de unificação ou endereços.
- Não alterar status pago, dados de cliente, pagamento ou expedição.

## Fase 2 — Crossell pela uazapi
### Montagem
- Escolha entre **Template Meta** e **WhatsApp Business — uazapi** no Crossell do modal da live.
- Ofertas reutilizáveis com blocos ordenados de texto, foto, áudio e botões, com prévia, edição, remoção e seleção de fotos do catálogo existente.
- Manter a instância da conversa; não trocar o número para contornar bloqueios ou multiplicar disparos.

### Fluxo recomendado
1. A equipe seleciona a oferta no chat de uma cliente que já comprou e autoriza o convite.
2. Enviar primeiro uma mensagem curta, por exemplo: “Quer ver uma opção para aproveitar o mesmo envio?”, com **Quero ver**, **Falar com a vendedora** e **Não quero ofertas**.
3. Só liberar os blocos de produto após interesse explícito. A compra, sozinha, não vale como autorização geral para marketing.
4. **Quero ver** e **Falar com a vendedora** destacam o card com **INTERESSE EM CROSSELL**, além de **NÃO LIDA**, e colocam a cliente no início dos Pagos. Abrir o chat mostra a oferta associada à resposta.
5. **Não quero ofertas** registra a recusa pelo mecanismo existente de descadastro, interrompendo os blocos ainda não enviados. Atendimento humano continua disponível.
6. Se os botões não funcionarem no aparelho/provedor, permitir resposta textual identificável, sem enviar uma segunda oferta automaticamente.

### Proteções contra repetição e excesso
- Reusar os mecanismos de fila existentes; reservar cada envio de forma exclusiva e registrar o resultado de cada bloco.
- Proposta de regra: uma oferta por cliente na mesma live, mesmo com dois pedidos pagos; sem follow-up automático para quem não responde.
- Não repetir bloco confirmado nem reiniciar sequência após recarregar a página ou clicar duas vezes.
- Resultado incerto do provedor fica em revisão, sem reenvio automático. Reenvio pela equipe exige confirmação explícita e histórico visível.
- Verificar descadastro, bloqueio e elegibilidade tanto ao agendar quanto antes de enviar cada bloco.
- Enviar em sequência por instância, respeitando o ritmo existente e sem deixar outras rotinas ignorarem a reserva. Mostrar pausa/cancelamento e falhas para a equipe.
- Não adotar um número de segundos como “seguro”. Se for necessário acrescentar tetos diários ou novos controles de ritmo, apresentar os valores antes de ativá-los; são controles próprios do sistema, não garantia da Meta.
- Começar com envio individual autorizado; disparo automático para todos os pagos fica fora desta fase.

## Consultas e atualização
- Hoje o Crossell faz uma consulta de templates ao abrir e uma chamada à Meta ao selecionar o template; não tem atualização periódica própria. Isso não inclui as consultas já usadas pelo modal de WhatsApp.
- A mudança nos Pagos não deve acrescentar consulta por card ou por mensagem: usar os pedidos já carregados, o resumo indexado das conversas e o aviso de mensagem em tempo real existente.
- Ofertas uazapi: uma busca paginada ao abrir o seletor, sem repetição periódica. Respostas de interesse atualizam pelo aviso em tempo real existente.
- Se a integração exigir consulta adicional de atividade, limitar aos clientes carregados, em lote, e documentar o custo antes de implementar. Não baixar histórico inteiro nem criar novo cron por minuto.

## Detalhes técnicos
- Crossell atual: `src/components/events/EventCrossellDialog.tsx`, envio direto por `meta-whatsapp-send-template`.
- Cards pagos/agrupamento: `src/components/events/EventPaymentCardsBar.tsx`.
- Reusar `liveContactUnread`, o marcador de leitura por evento e `useWaMessageBroadcast`; comparar atividade de todos os pedidos agrupados e usar a instância da conversa.
- Avaliar extensão das estruturas de ofertas/fila existentes antes de criar tabelas. A fila `event-bulk-send` atual é específica de templates Meta, usa pausa de 1,2 s e retentativas: não copiar essa configuração para uazapi.
- Persistir IDs estáveis da oferta, execução, bloco e resposta do botão; conferir evento, destinatário e instância no recebimento. Consumo atômico evita que callbacks duplicados gerem novo envio ou aviso repetido.
- Preservar `quoted_message_id` e IDs reais do provedor. Não usar IA para identificar cliques ou classificar interesse determinístico.
- Validar sessão/permissão, entradas e acesso ao evento no servidor; escritas de execução protegidas e índices conferidos para novas consultas.

## Testes e entrega
- Testar prioridade de não lidos, leitura, nova mensagem após leitura, dois pedidos pagos e abertura do WhatsApp sem acionar unificação.
- Testar duplicidade de clique/agendamento/callback, descadastro antes e durante sequência, falha incerta e retomada sem repetir blocos enviados.
- Conferir montagem/prévia de texto, foto, áudio e botões no navegador.
- Envio e clique reais exigem um número de teste autorizado: sem isso, informar explicitamente que entrega e botões reais não foram verificados.
- Entregar cada fase com arquivos alterados, testes e limitações; nenhuma publicação do site.