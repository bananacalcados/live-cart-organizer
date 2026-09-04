# Chat do PDV em Linhas (visão por etapas de atendimento)

Levar para o WhatsApp do PDV o mesmo conceito das linhas da Live: todas as etapas visíveis ao mesmo tempo, cards por conversa, movimentação automática por regra e manual por botão. A vendedora escolhe a versão visual ao abrir o chat; a versão tradicional continua intacta.

## Como vai funcionar

Ao abrir o WhatsApp do PDV (depois de escolher a vendedora), aparece a escolha:
**Tradicional** (lista à esquerda + chat à direita, como hoje) ou **Linhas** (nova). A escolha fica lembrada no aparelho, com um botão no topo para trocar a qualquer momento.

### Linhas (de cima para baixo)

| Linha | Quem entra | Como sai |
|---|---|---|
| NOVAS | Conversa nunca atendida; conversa FINALIZADA em que a cliente voltou a falar | Vendedora responde e passam 5 min sem retorno → Follow Up; cliente responde de novo → Não lidas |
| NÃO LIDAS | Já respondemos antes e a cliente mandou nova mensagem (última mensagem é dela) | Vendedora responde e passam 5 min → Follow Up |
| FOLLOW UP | Última mensagem é nossa há mais de 5 min | Cliente responde → Não lidas |
| PEDIDOS DA LIVE | Conversas de clientes com pedido em Live Shopping (mesma regra do filtro "Live" atual), enquanto não finalizadas | Finalizar → Finalizadas |
| SUPORTE | Movida manualmente OU com ticket de suporte aberto | Mover manualmente / Finalizar |
| FINALIZADAS | Finalizada por qualquer atendente | Cliente manda mensagem → volta para NOVAS |

Regras de prioridade quando uma conversa se encaixa em mais de uma linha:
1. Marcação manual (Suporte ou linha escolhida) vence as regras automáticas, até a cliente mandar nova mensagem ou alguém finalizar.
2. Finalizada vence tudo (até a cliente voltar a falar).
3. Pedido da Live vence Novas / Não lidas / Follow Up.
4. Durante os 5 minutos após a nossa resposta, o card **fica na linha onde estava** e mostra um contador ("há 2 min"); ao completar 5 min, muda sozinho para Follow Up, sem recarregar.

Finalizar é compartilhado: já é gravado no servidor hoje, então some para todas as atendentes ao mesmo tempo. O mesmo vale para a marcação manual de linha (gravada no servidor, em tempo real).

### Cards e chat
- Card = mesmo card de conversa já usado na lista (nome, última mensagem, hora, instância, atendente, tags), com badge de não lidas e o contador de tempo.
- Clicar no card abre o chat em **janela** (igual à Live), reaproveitando a tela de conversa atual com todos os botões: Checkout, Boleto, Pix, Catálogo, Suporte, Transferir, Bloquear, Finalizar, Espera de produto, Exportar, etc.
- Novo botão **Transferir etapa** no chat e no card (menu): escolhe a linha destino (Novas, Não lidas, Follow Up, Suporte, Finalizadas). O botão **Suporte** existente, ao abrir o ticket, também move o card para SUPORTE.
- Cada linha pode ser recolhida (lembrado no aparelho) e mostra o contador de cards; a busca e o filtro de instância do topo continuam valendo.

## Etapas de implementação

### Etapa 1 — Seleção de versão + linhas automáticas (sem mover manualmente)
- Tela de escolha Tradicional / Linhas ao entrar, lembrada por aparelho, botão para alternar.
- Novo componente de linhas no PDV reutilizando a lista de conversas já carregada (mesmos dados, sem nova consulta pesada).
- Classificação automática: Novas, Não lidas, Follow Up (com temporizador de 5 min), Pedidos da Live, Suporte (por ticket aberto), Finalizadas.
- Clique no card abre o chat em janela com todos os botões atuais; Finalizar já sai da linha para todos.

**Validação:** abrir no PDV, comparar as linhas com as abas atuais, testar o temporizador de 5 min e finalizar em dois aparelhos.

### Etapa 2 — Transferência manual de etapa
- Tabela de marcação manual por conversa (telefone + instância), com quem moveu e quando, compartilhada em tempo real.
- Botão **Transferir etapa** no chat e no menu do card; botão Suporte move para SUPORTE.
- Regra de expiração da marcação manual: nova mensagem da cliente ou Finalizar limpa a marcação e volta ao automático.

**Validação:** mover cards entre linhas e confirmar que outra atendente vê a mudança na hora.

### Etapa 3 — Ajustes finos (após uso real)
- Contadores por linha no topo, ordenação dentro da linha (mais antigas primeiro em Não lidas / Follow Up), atalhos de teclado e o que surgir do uso.

## Detalhes técnicos

- Tela: `POSWhatsApp.tsx` ganha estado `viewMode: "classic" | "lanes"` (localStorage `pos-wa-view-mode:<storeId>`); quando `lanes`, renderiza novo `POSWhatsAppLanes.tsx` no lugar do par lista+chat, mantendo todos os hooks/estados atuais (conversas, enriquecimento, instâncias, atribuições).
- Classificação em `src/lib/chat/conversationLanes.ts` (função pura, testável): recebe conversa enriquecida (`conversationStatus`, `isFinished`, `lastMessageAt`, direção da última msg, `eventNames`/mapa da Live, tickets abertos, marcação manual) e devolve a linha. Um `setInterval` de 30 s só reavalia o temporizador de 5 min (sem consulta ao banco).
- Linhas: reaproveitar `LiveLaneSection` (mover para `src/components/chat/` como componente genérico) e o item de card de `ConversationList`.
- Chat em janela: `Dialog` envolvendo o `ChatView` atual com as mesmas props/callbacks que a versão tradicional usa (Checkout, Pix, Boleto, Catálogo, Suporte, Transferir, Bloquear, Finalizar, Waitlist, Exportar).
- Finalizadas: já usa `chat_finished_conversations` (servidor + Realtime) — compartilhado entre usuários sem mudança.
- Suporte por ticket: reutilizar `useSupportPhones` (telefones com ticket aberto).
- Etapa 2 — nova tabela `chat_conversation_lanes` (`phone_key` DDD+8, `whatsapp_number_id`, `lane`, `moved_by`, `moved_at`, `cleared_at`), GRANT para `authenticated`/`service_role`, RLS para usuários autenticados, Realtime habilitado; trigger que limpa a marcação quando chega mensagem incoming ou a conversa é finalizada. Hook `useChatConversationLanes` no molde de `useEventContactLanes`.
- Nada muda para quem continuar na versão Tradicional; nenhuma consulta nova é adicionada na Etapa 1.
