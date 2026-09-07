# Forma de pagamento "COMPROU NO SITE" no botão PAGO da Live

## Objetivo
Marcar como PAGO um pedido da Live que a cliente acabou finalizando no site, sem duplicar nada: o pedido vai para a coluna PAGO, conta no faturamento do módulo EVENTOS, mas não cria venda no PDV nem pedido na Expedição.

## Como vai funcionar na prática
- No botão PAGO do card do pedido, a lista de formas de pagamento passa a começar por **COMPROU NO SITE**, seguida de PIX e das demais.
- Ao escolher essa opção e confirmar:
  - o pedido vai para a coluna **Pago** (com a etiqueta "Compra finalizada no site");
  - **não** é criada venda no PDV, nem pedido na Expedição, nem NF-e;
  - a cliente deixa de figurar como "fez pedido e não pagou" nas próximas lives.
- O card e o modal do pedido mostram claramente a marcação "COMPROU NO SITE", para ninguém procurar esse pedido na Expedição.
- Se alguém marcar por engano, basta voltar o pedido para outra etapa/forma de pagamento: a marcação é limpa.

## Faturamento
- **Conta** no faturamento do módulo Eventos: dashboard geral de eventos e página/painel da Live (inclusive Painel da Apresentadora), pois o pedido fica como pago.
- **Não aparece** no PDV (dashboard de vendas, expedição, fiscal, comissão/FOLHA), porque nenhuma venda é criada — o valor já entra lá pela venda vinda do site.
- Sem comissão/rateio de Live para esse pedido.

## Detalhes técnicos
1. **Banco (migração)**
   - Nova coluna `orders.paid_on_site boolean not null default false` (+ índice parcial).
   - Ajustar `public.trg_route_paid_event_order_to_pos()`: retornar cedo quando `NEW.paid_on_site = true`, antes de chamar `event-order-route-to-pos`.
2. **Guarda no servidor**
   - Em `supabase/functions/event-order-route-to-pos/index.ts`, incluir `paid_on_site` no select e responder `{ skipped: "paid_on_site" }` sem rotear (proteção para chamadas manuais, ex.: `StorePickupWizard`).
3. **Frontend**
   - `src/components/MarkOrderPaidDialog.tsx`: adicionar `{ value: "COMPROU NO SITE", ... }` como primeiro item de `MANUAL_PAYMENT_METHODS`; ao confirmar com essa opção, gravar `paid_on_site: true`, `is_paid: true`, `paid_externally: true`, `stage: "paid"`, `payment_method_label: "COMPROU NO SITE"`, `payment_confirmed_source: "site"`; nas demais formas, gravar `paid_on_site: false`.
   - Nota explicativa no diálogo: "Não cria venda no PDV nem pedido na Expedição".
   - `src/types/database.ts`: campo `paid_on_site?: boolean` em `DbOrder`.
   - Badge "COMPROU NO SITE" em `OrderCardDb.tsx` e no `OrderFullViewDialog.tsx`/`OrderDialogDb.tsx`.
   - Ao mover o pedido para uma etapa não paga, limpar `paid_on_site`.
4. **Verificação**
   - Teste unitário do rótulo/flag em `src/test/`.
   - `bunx tsgo --noEmit -p tsconfig.app.json` e conferência do log de build.
   - Teste real: marcar um pedido de teste como COMPROU NO SITE e confirmar que ele fica em Pago, soma no faturamento do evento e não gera venda no PDV.
