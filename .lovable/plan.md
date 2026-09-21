# Nova etapa AGUARDANDO na Expedição

Fez sentido sim — e a lógica fecha. Só tem um ponto que precisa ficar explícito: um pedido pode ficar "meio separado". Hoje o sistema só sabe dizer "pedido inteiro pronto / pedido inteiro pendente". Para a etapa Aguardando funcionar, o sistema passa a guardar **quanto de cada item já foi separado**.

## Como vai funcionar na prática

**Nova aba "Aguardando"** entre Separação e Conferência.

**1. Pedido com item faltando**
Na Separação, você marca os produtos que tem. Se o pedido ficou incompleto, aparece o botão **"Mandar para Aguardando"**: o pedido sai da fila de Separação como card na aba Aguardando, com a etiqueta **AGUARDANDO RESTANTE DOS PRODUTOS** e a lista do que já foi separado e do que falta.
Os produtos que ainda faltam **continuam aparecendo na lista de Separação** (só a quantidade que falta), para serem bipados quando chegarem.

**2. Envio unificado**
Se a cliente tem 2 ou 3 pedidos unificados e só parte deles está completa, o **grupo inteiro** vai para Aguardando — nenhum pedido do grupo escapa sozinho para a Conferência. Assim ninguém despacha um envio pela metade.

**3. Saída da etapa**
Quando o produto que faltava chega e é separado, o card em Aguardando fica verde ("completo") e o botão **AVANÇAR PARA CONFERÊNCIA** libera. Também existe a opção de forçar o avanço manualmente (caso decidam enviar parcial mesmo assim).

**Contadores** das abas passam a mostrar Aguardando, e o botão grande de avanço da Separação continua mandando direto para Conferência só quem está 100% completo.

## Parte técnica

- **Banco:** coluna `expedition_picked_qty` (numeric, default 0) em `pos_sale_items`; novo valor `aguardando` em `pos_sales.expedition_stage` (coluna é texto livre, sem constraint) — nenhuma trigger de estoque/fiscal é tocada, pois todas reagem apenas a `concluido`.
- **`expeditionTypes.ts`:** `ExpStage` ganha `"aguardando"`; `EXP_STAGES` recebe a aba entre separação e conferência; `nextStage`/`prevStage` passam a usar mapa explícito (`separacao → conferencia`, `aguardando → conferencia`, `prev(aguardando) = separacao`, `prev(conferencia) = separacao`) para não desviar o fluxo normal; `ExpItem` ganha `picked_qty`.
- **`ExpPickingList.tsx`:** recebe também os pedidos em `aguardando` e desconta `picked_qty` das linhas (item zerado some da lista); ao avançar, grava `expedition_picked_qty` de cada item separado; pedidos incompletos (e todo o grupo `expedition_group_id` de um pedido incompleto) vão para `aguardando`; botão "Mandar para Aguardando".
- **`POSExpedition.tsx`:** aba/contador `aguardando`; cards com badge "AGUARDANDO RESTANTE DOS PRODUTOS", separados/pendentes por item; ações Avançar (habilitado quando completo, com forçar) e Voltar para Separação (zera `picked_qty`).
- Não mexe em: baixa de estoque, NF-e/NFC-e, snapshots fiscais, unificação de pedidos existente.
