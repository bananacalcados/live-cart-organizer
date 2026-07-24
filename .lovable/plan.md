
# Nova aba EXPEDIÇÃO no PDV

## O que entendi (mapeamento completo)

1. Nova aba **Expedição** dentro do PDV de cada loja, visual colorido/vibrante, textos grandes, em etapas (estilo módulo Expedição Beta).
2. Só entram pedidos de origem **Live**, **WhatsApp**, **Online (link de pagamento)** e qualquer venda via checkout transparente. Venda presencial de balcão não entra.
3. **Isolamento por loja**: cada pedido aparece apenas no PDV da loja onde foi criado (Site/Live, Pérola, Centro).
4. Hoje o pedido pago de Live já cai direto na aba **Pedidos**. Passa a cair primeiro em **Expedição**; só aparece em Pedidos quando a expedição for concluída.
5. Etapas:
   - **1. Novos Pedidos** — só os sem expedição iniciada. Filtros: local da venda (Live/WhatsApp/Online), data, meio de envio. Seleção múltipla + botão "Avançar etapa".
   - **2. Preparação** — igual à 1, mais **unificação de pedidos do mesmo cliente** (como no módulo Expedição).
   - **3. Separação** — lista de todos os produtos a separar. Filtros combináveis (produtos idênticos por cor/tamanho, por cliente, por meio de envio). Mostra **em qual loja há estoque** de cada item.
   - **4. Conferência** — agrupado por cliente, do mais antigo para o mais recente, com outras ordenações. Ao abrir o cliente: modal de **bipagem** item a item, checklist grande de **pés corretos** e **defeitos**; após bipar tudo, exibe dados completos (nome, telefone, e-mail, endereço, @Instagram, local da venda + qual live, vendedor, meio de envio escolhido). Depois: **Gerar NF-e** (XML, PDF e número/chave da nota) e **definir meio de envio**:
     - Transportadora/Correios → exige **código de rastreio**;
     - Mototaxi → exige **nome do mototaxista**;
     - Retirada na loja → exige **qual loja**.
   - **5. Concluídos** — lista; ao clicar abre modal com todas as informações do pedido e do cliente, código e **link de rastreio**, e botão para **falar no WhatsApp**. Ao entrar nesta etapa, o pedido passa a aparecer na aba **Pedidos** do PDV.

## Como será implementado

### Banco de dados
- Novos campos em `pos_sales`:
  - `expedition_stage` (`novo` | `preparacao` | `separacao` | `conferencia` | `concluido`) — default `novo` **apenas** para vendas de origem online/live; vendas de balcão nascem `concluido` (não mudam de comportamento).
  - `expedition_group_id` (unificação de pedidos do mesmo cliente), `shipping_carrier`, `tracking_code`, `courier_name`, `pickup_store_id`, `expedition_finished_at`.
- Nova tabela `pos_expedition_checks` (por item: bipado, pés corretos OK, defeito, observação, quem conferiu, horário) com RLS e GRANTs.
- Gatilho/ajuste na criação de venda (`event-order-route-to-pos`, checkout transparente, links de pagamento, WhatsApp) para marcar a origem e iniciar em `novo`.

Importante: a venda continua sendo criada no mesmo momento de hoje (para não quebrar baixa de estoque, fiscal, comissões e métricas). A mudança é **de visibilidade**: a aba Pedidos passa a filtrar `expedition_stage = 'concluido'`.

### Frontend
- `src/components/pos/POSExpedition.tsx` — container com as 5 etapas (barra de etapas colorida, contadores grandes).
- Subcomponentes: `ExpNewOrders.tsx`, `ExpPreparation.tsx` (com unificação), `ExpPicking.tsx` (lista de separação + estoque por loja), `ExpConference.tsx` + `ExpConferenceDialog.tsx` (bipagem, checklist, NF-e, envio), `ExpCompleted.tsx` + modal de detalhes com rastreio e WhatsApp.
- Registro da aba em `src/pages/POS.tsx` (`{ id: "expedition", label: "Expedição", icon: Boxes }`), sempre recebendo `storeId` para o isolamento por loja.
- Reaproveitamento: `EmitNfeButton`/`openFiscalDocument` para NF-e, `POSBarcodeScanner` para bipagem, padrão de unificação já usado na Expedição.
- Tokens de cor novos no design system para o visual vibrante (sem cores hardcoded).

### Filtros
- Etapas 1 e 2: origem, período, meio de envio, busca por nome/telefone.
- Etapa 3: filtros combináveis (multi-seleção) por produto idêntico, cliente e meio de envio, com agrupamento dinâmico.
- Etapa 4: ordenação por mais antigo (padrão), valor, meio de envio, quantidade de itens e vendedor.

### Ordem de entrega
1. Migração de banco (campos, tabela de conferência, RLS/GRANTs, backfill: pedidos online/live existentes ainda não enviados entram como `novo`; o resto `concluido`).
2. Aba + etapas 1 e 2 (filtros, avanço em lote, unificação).
3. Etapa 3 (separação com estoque por loja).
4. Etapa 4 (bipagem, checklist, NF-e, meio de envio/rastreio).
5. Etapa 5 (concluídos + modal) e filtro da aba Pedidos.

### Riscos e cuidados
- A aba Pedidos passa a esconder o que está em expedição — por isso o backfill marca corretamente o histórico como `concluido`.
- Nada de mudança em baixa de estoque, emissão fiscal existente ou comissões.
