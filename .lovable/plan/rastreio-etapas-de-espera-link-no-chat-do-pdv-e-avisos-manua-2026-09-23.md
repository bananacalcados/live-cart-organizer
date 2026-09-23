# Rastreio: etapas de espera, link no chat do PDV e avisos manuais

## 1. Duas novas etapas automáticas depois de "Enviado"

Hoje a página para em "Pedido enviado" e só volta a se mexer quando o código real é digitado na Conferência. Quando isso demora, o cliente fica dias vendo a mesma linha.

Passam a existir duas linhas automáticas, contadas a partir do momento em que o pedido entrou em "Enviado", e **somente enquanto não houver código real**:

- **+1 dia** — "Pedido chegando em um centro de distribuição" ("Seu pedido chegou a uma unidade de distribuição e segue para a próxima etapa.")
- **+2 dias** — "Pedido a caminho" ("Seu pedido está a caminho da sua cidade.")

Depois disso o acompanhamento para e espera o código real. Assim que o código real é registrado, as movimentações verdadeiras continuam a linha do tempo normalmente (nunca voltando no tempo) e essas duas linhas permanecem no histórico, sem contradição.

Nada disso acontece para retirada na loja, nem para pedido já entregue, nem depois que existe código real.

## 2. Avisos manuais (extraviado, atraso, etc.)

Um novo botão no card do pedido, dentro do modal do cliente no WhatsApp do PDV, abre as opções:

- Extraviado
- Atraso na rota
- Cancelado
- Greve dos Correios
- Conferência de endereço

Ao marcar, a página pública ganha uma linha com o aviso, na data da marcação, e o selo de status passa a mostrar esse aviso. Quando um evento real novo chegar da transportadora depois dessa data, a linha do tempo volta a andar normalmente por cima do aviso — o aviso continua no histórico. Há também a opção "Remover aviso".

Textos públicos (sem citar transportadora):

| Opção | Título público | Detalhe |
| --- | --- | --- |
| Extraviado | Pedido em verificação | Estamos localizando seu pedido junto ao transporte. Já estamos cuidando disso. |
| Atraso na rota | Atraso na rota | A rota do seu pedido sofreu um atraso. Ele segue a caminho. |
| Cancelado | Envio cancelado | O envio deste pedido foi cancelado. Fale com a gente. |
| Greve dos Correios | Atraso por paralisação | Há uma paralisação afetando as entregas na região. Seu pedido segue na fila. |
| Conferência de endereço | Conferência de endereço | Precisamos confirmar seu endereço para concluir a entrega. Fale com a gente. |

## 3. Link de rastreio no modal do cliente

Cada pedido com envio passa a mostrar, no card, o código próprio (BC-XXXXXX) com dois botões: **Copiar link** e **Enviar no WhatsApp** (usa a instância da conversa, mensagem curta com o link). Pedidos de retirada e pedidos sem acompanhamento não mostram o bloco.

## 4. Link retroativo dos últimos 15 dias

Criação dos registros de acompanhamento para todos os pedidos pagos dos últimos 15 dias que ainda não têm um, inclusive os que ainda não passaram pela expedição. Onde já existe código real da transportadora no pedido, ele é aproveitado e a etapa já entra como "Enviado".

## Detalhes técnicos

- **Migração**: `shipment_simulations` ganha `incident_type text`, `incident_at timestamptz`, `incident_note text`. Backfill dos últimos 15 dias em SQL de dados (run_sql), reaproveitando `gen_shipment_public_code()` e `pos_sales.tracking_code`.
- **`supabase/functions/_shared/shipment-stages.ts`**: `POST_SHIPPED_STEPS` (offset em dias + título + detalhe) e `INCIDENT_LABEL` com os 5 avisos.
- **`shipment-tracking-public/index.ts`**: após o evento "enviado", se não há `real_tracking_code` e não é `pickup`, empurra as linhas automáticas cujo horário já passou; ao final, se há `incident_type`, insere a linha do aviso na data `incident_at` (respeitando a trava de não voltar no tempo) e o `status` passa a ser o aviso, salvo se houver evento real mais recente.
- **`src/lib/shipmentTracking.ts`**: `setShipmentIncident(saleId, type|null)`, `IncidentType`, `INCIDENT_OPTIONS`.
- **`src/components/pos/CustomerOrderActions.tsx`**: novo bloco (carrega `tracking_code` + `incident_type` por `sale_id`) com copiar/enviar link e menu de avisos. Como este componente é usado pelo chat do PDV e pelo painel da Live, os dois ganham o recurso.
- Envio pelo WhatsApp reaproveita `sendTrackingWhatsApp` (`src/lib/pos/trackingSend.ts`), com a instância vinculada à conversa.
