## Situação atual

No módulo **Expedição Beta** **não existe** botão de emissão de NF-e (modelo 55). Hoje a emissão só acontece em dois lugares:

1. **Expedição clássica** (`ExpeditionOrdersList`) — botão "Emitir NF-e" por pedido, chamando `supabase.functions.invoke('nfe-emitir', { order_id })`.
2. **POS / vendas online** — via `pos_sales`.

A boa notícia: a edge function `nfe-emitir` **já aceita `company_id` opcional** no body (`{ order_id, company_id, ambiente }`). A prioridade hoje é: `forcedCompany > pos_stores.company_id > PILOT_COMPANY_ID`. Ou seja, toda a infra fiscal (BrasilNFe, fila de contingência SEFAZ, `fiscal_documents`, DANFE/XML) já existe — só falta UI no Beta + um seletor de CNPJ.

## Plano de implementação

### 1. Componente reutilizável `EmitNfeButton`
Criar `src/components/fiscal/EmitNfeButton.tsx` que:
- Recebe `orderId` e `onSuccess`.
- Carrega `fiscal_documents` (modelo 55) do pedido para mostrar status atual (autorizada / rejeitada / pendente / não emitida).
- Se **já autorizada**: mostra número, série, chave e botões "Baixar DANFE" / "Baixar XML" / "Cancelar NF-e" (reusa `CancelFiscalDocDialog`).
- Se **não emitida ou rejeitada**: abre um **Dialog de seleção de CNPJ** antes de emitir.

### 2. Dialog `SelectCompanyDialog`
- Lista empresas de `companies` (filtrando `active = true` e que tenham `brasilnfe_token` configurado).
- Mostra: Razão Social, CNPJ formatado, ambiente (homologação/produção).
- Opção de **lembrar última escolha** em `localStorage` (`expedition_beta_last_company_id`) para agilizar emissões em lote.
- Botão "Emitir NF-e" chama `nfe-emitir` com `{ order_id, company_id }`.
- Trata os 3 retornos: `ok` (toast sucesso + reload), `contingencia` (toast warning), erro (toast com `rejection_message`).

### 3. Integração no fluxo do Beta
- Adicionar o `EmitNfeButton` no card de pedido da etapa **"Conferência"** (`BetaPackingStation`) e/ou no **"Despacho"**, conforme onde fizer mais sentido no fluxo de vocês.
- Pergunta: **em qual etapa do Beta o botão deve aparecer?** Sugestão: após Conferência concluída e antes de gerar etiqueta (mesmo ponto da Expedição clássica).

### 4. (Opcional) Emissão em lote
- Na lista geral do Beta, ação "Emitir NF-e em lote" para pedidos selecionados, usando o mesmo CNPJ escolhido uma única vez. Itera chamando `nfe-emitir` com pequeno delay para não estourar BrasilNFe.

## Detalhes técnicos

- **Nenhuma migration necessária** — `fiscal_documents`, `companies` e a edge `nfe-emitir` já suportam tudo.
- O `company_id` é passado no body e a função resolve token BrasilNFe + ambiente automaticamente.
- Idempotência: a função já verifica se existe NF-e autorizada para o `order_id` e bloqueia reemissão (precisa cancelar antes).
- Reaproveitamento: `CancelFiscalDocDialog` e `extractEdgeError` já existem.

## Perguntas antes de implementar

1. Em qual(is) etapa(s) do Beta o botão deve aparecer (Conferência, Despacho, ambos)?
2. Quer **emissão em lote** já nessa primeira versão, ou só individual por pedido?
3. Deseja **lembrar o último CNPJ escolhido** por usuário (localStorage) para não perguntar a cada pedido?