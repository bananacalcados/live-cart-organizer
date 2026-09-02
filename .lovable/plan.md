# Envio em massa de Template API e Cross-sell por etapa do Kanban (Eventos > Live)

## Objetivo
Dentro de um evento, selecionar clientes por etapa do Kanban (ex.: "Aguardando Pagamento", "Pago") e disparar para todos de uma vez o mesmo Template API ou o mesmo Template de Cross-sell (carrossel) que hoje só é enviado manualmente chat a chat.

## Como vai funcionar (visão do usuário)

1. **Botão "Envio em massa"** na barra do Kanban do evento (aba Pedidos) e também na Central da Live (modo WhatsApp).
2. **Passo 1 – Público:** escolher uma ou mais etapas do Kanban. A lista mostra os pedidos dessas etapas com checkbox (marcar/desmarcar todos), nome/@, telefone, instância vinculada e um aviso quando o cliente não pode receber (sem telefone, bloqueado, opt-out "PARAR", risco de chargeback, já recebeu esse template neste evento).
3. **Passo 2 – Mensagem:** escolher o tipo:
   - **Template API** (mesma lista de templates Meta aprovados usada no chat), ou
   - **Cross-sell** (mesma lista de carrosséis aprovados do `EventCrossellDialog`, com imagens por card via upload/Shopify).
4. **Variáveis inteligentes:** cada `{{n}}` pode ser preenchida com um valor fixo (igual para todos) ou com uma variável do pedido, resolvida por cliente: nome, @ Instagram, valor da compra, qtd. de itens, 1º produto, link do checkout, link autenticado da Área de Membros.
5. **Passo 3 – Revisão e envio:** prévia com 1 cliente de exemplo, contagem final (X aptos, Y ignorados e o motivo), botão "Enviar para X clientes". O envio entra em fila e a tela mostra progresso em tempo real (enviados / falhas / ignorados).
6. **Histórico:** sub-aba "Envios em massa" no evento com cada disparo feito (template, etapa, data, quem enviou, resultado por cliente e motivo de falha), com opção de reenviar só para os que falharam.

## Regras de negócio
- **Instância por conversa:** cada cliente recebe pela instância vinculada ao seu histórico (regra telefone+instância). Quem não tem histórico usa a instância escolhida no diálogo. Para Cross-sell, o template pertence a uma instância; clientes vinculados a outra instância aparecem como "ignorado: instância diferente".
- **Supressões obrigatórias:** bloqueados, opt-out "PARAR" e chargeback são sempre excluídos (guards já existentes). Sem furar cota.
- **Anti-duplicidade:** o mesmo template não vai duas vezes para o mesmo telefone no mesmo evento (a menos que o usuário marque "reenviar mesmo assim").
- **Ritmo:** envio sequencial com pausa entre mensagens (como nos disparos existentes) para não estourar rate limit da Meta; lote processado por função de backend, não pelo navegador (funciona mesmo se fechar a aba).
- **Registro no chat:** cada envio grava em `whatsapp_messages` com o texto renderizado e a mídia do header, igual ao envio manual.

## Etapas de implementação

**Etapa 1 – Banco (1 migração)**
- Tabelas `event_bulk_sends` (evento, tipo template/crossell, nome do template, idioma, componentes base, mapeamento de variáveis, etapas selecionadas, instância fallback, status, contadores, criado_por) e `event_bulk_send_items` (send_id, order_id, telefone, instância, status pending/sent/failed/skipped, motivo, message_id, tentativas, locked_until). GRANTs, RLS para autenticados, índice único (send_id, telefone), realtime nos itens.

**Etapa 2 – Backend**
- Função `event-bulk-send-enqueue`: recebe seleção + configuração, resolve variáveis por pedido, aplica supressões e anti-duplicidade, insere itens.
- Função `event-bulk-send-worker` (cron a cada minuto + acionada logo após o enqueue): claim atômico de itens, envia via `meta-whatsapp-send-template` (componentes por cliente, header de imagem no formato `{image:{link}}`), atualiza status e contadores.

**Etapa 3 – Frontend**
- `EventBulkSendDialog.tsx` (3 passos acima), reaproveitando a lógica de listagem/preview de `LiveWhatsAppChatDialog` (templates simples) e `EventCrossellDialog` (carrossel, cards, VarPicker).
- Botão na barra do Kanban (`Index.tsx`) e na `LiveAttendanceCenter`.
- Painel de progresso (realtime nos itens) e sub-aba de histórico `EventBulkSendsHistory.tsx` com reenvio de falhas.

**Etapa 4 – Validação**
- Teste com 2–3 pedidos reais em etapa de teste; conferir gravação no chat, supressões e anti-duplicidade.

## Detalhes técnicos
- Fonte dos templates: `meta-whatsapp-get-templates` (APPROVED) e `templates_carrossel` (scope event/pos, APPROVED, por `whatsapp_number_id`).
- Resolução de instância por telefone reutiliza a mesma lógica de `useConversationInstance` no backend (último `whatsapp_number_id` com mensagens do sufixo DDD+8).
- Link da Área de Membros por cliente via `issue-member-magic-link` já existente.
- Supressões via `_shared/blocked-guard.ts` + `automation_opt_outs` + `chargeback_gate`.
- Renderização do texto no chat via `_shared/meta-template-render.ts` (já usado no envio individual).
