# Automação de Carrossel WhatsApp recorrente (operada pelo PDV)

Vendedoras criam, de dentro do PDV, campanhas recorrentes de carrossel. Elas definem **conteúdo + público + ritmo**; o sistema impõe dedup, cooldown, teto global, opt-out e tratamento de falha de forma invisível. Reaproveita o máximo da infraestrutura existente.

## Decisões adotadas (recomendadas — me corrija se quiser mudar)
- **Fonte de cliente:** `customers_unified` via view `crm_customers_v` (regra do projeto). O `cliente_id` do brief = `customers_unified.id`.
- **Opt-out:** usar o campo já existente `customers_unified.opt_out_mass_dispatch` (não criar tabela nova).
- **Teto global de marketing:** consolidar via VIEW sobre os logs existentes (`dispatch_recipients` + `automation_dispatch_sent` + os envios da nova campanha). Sem tabela duplicada.
- **Provedor:** carrossel só dispara por número **Meta/WABA oficial** (`whatsapp_numbers` tipo meta). Campanha bloqueia seleção de número não-oficial (guard-rail Seção 0/10).
- **Parâmetros default:** cooldown 30 dias · teto global 1 msg / 7 dias · janela de atribuição 7 dias (last-touch) · retry 48h × 3 tentativas.

## O que já existe e será reaproveitado
- **Motor de filtros (público):** `automation-dispatch-audience` + `dispatch-orchestrator` (pg_cron/min) + `dispatch-worker` (claim SKIP LOCKED). Filtros JSONB em `automation_flows.trigger_config` / `dispatch_history.audience_filters` — é o análogo do `filtro_json`.
- **Picker de foto Shopify + cropper 1:1:** `AutomationFlowBuilder.tsx` (`openShopifyForCard` → `selectShopifyImage` → `ImageCropDialog`) usando `fetchProducts` de `@/lib/shopify`.
- **Atribuição de venda (ROI):** `dispatch-attribution` já faz last-touch + janela `window_days` cruzando `pos_sales`/`zoppy_sales`/`orders` por sufixo de telefone.
- **Tarefas + popup do PDV:** `pos_task_definitions`, `pos_seller_task_instances`, `pos_task_contacts`, gerador `pos-tasks-generate`, board `POSSellerTasksBoard`, popup `SellerTaskReminderPopup`.
- **Carrossel ponta a ponta:** `meta-whatsapp-create-template` (cria a escada), `meta-whatsapp-send-template`, `meta-whatsapp-webhook` (status), coluna `whatsapp_messages.template_payload`, render `CarouselMessageBubble`.
- **Cron seguro:** `_shared/cron-guard.ts` (`x-cron-secret`).

## O que é novo (criar do zero)
4 tabelas da campanha, a query de lote (Seção 3), o resolvedor de template por contagem (Seção 4), o check de estoque consultivo e o wizard de 5 modais no PDV.

---

## Etapas (uma por vez — eu paro ao fim de cada uma para você testar)

### Pré-requisito (você, fora do código)
Validar que o número está na Cloud API oficial e consegue criar + enviar 1 carrossel de teste de 2 cards ponta a ponta. Sem isso o resto não roda.

### Etapa 1 — Escada de templates
- Tabela `templates_carrossel` (`qtd_cards` PK 2..10, `template_id`, `aprovado`) + GRANT/RLS.
- Tela admin para criar os 9 templates (2→10 cards) via `meta-whatsapp-create-template` e acompanhar aprovação (`meta-template-status-log`).

### Etapa 2 — Modelo de dados da campanha
- `campanhas_auto` (nome, criada_por, filtro_json jsonb, qtd_por_dia, dias_semana int[], cooldown_dias, ativa, tipo `lancamento|numeracao`).
- `campanha_cards` (campanha_id, ordem, shopify_product_id, shopify_variant_id, imagem_url, legenda, botao_tipo, botao_payload, status `ok|esgotado|inativo`, ultima_verificacao).
- `campanha_envios` (LOG/dedup: campanha_id, cliente_id, enviado_em, status `pendente|enviado|entregue|lido|falhou|capped`, erro, tentativas).
- VIEW `marketing_envios_globais` consolidando os logs para o teto global.
- Todas com GRANT + RLS.

### Etapa 3 — Seleção do lote + template + agendador
- RPC com a query da Seção 3 (filtro dinâmico via `crm_customers_v`, opt-out, cooldown da própria campanha, teto global, `ORDER BY ... NULLS FIRST`).
- Resolvedor de template pela contagem de cards `ok` (Seção 4); < 2 válidos → não dispara + gera tarefa.
- Edge function agendadora diária respeitando `dias_semana` (padrão cron-guard + pg_cron).

### Etapa 4 — Envio + webhook + tratamento de falha
- Worker: resolve template → grava `pendente` → envia carrossel via Cloud API (cards `ok`) → atualiza status pelo `meta-whatsapp-webhook`.
- Falhou/capped = **não alcançado** → re-enfileira após 48h, até 3 tentativas, depois encerra.
- Espelhar sucesso no log global.

### Etapa 5 — Teto global entre campanhas
- Aplicar a VIEW global na seleção do lote (anti-spam entre todas as automações de marketing).

### Etapa 6 — Atribuição de venda (ROI)
- Adaptar `dispatch-attribution` para a janela por envio (last-touch, 7 dias) por `campanha_envios`.
- Métricas por campanha: enviados, entregues, lidos, vendas, faturamento, ROI.

### Etapa 7 — UX no PDV (wizard de 5 modais)
1. Nome + tipo (lançamento/numeração).
2. Montar carrossel (2–10 cards) reusando picker Shopify + cropper; contador "X de 10".
3. Público: filtro pré-configurado + contagem estimada agora.
4. Ritmo: qtd/dia + dias da semana.
5. Revisão + ativar.
- Botão "Atualizar carrossel" reabre o Modal 2 da campanha existente (mantém ID e histórico).

### Etapa 8 — Check de estoque consultivo
- 1x/dia, antes dos lotes: `numeracao` → checa variante (≤0 = `esgotado`); `lancamento` → checa produto ativo (inativo = `inativo`). Grava `ultima_verificacao`.
- Card fora de `ok`: **não remove**, cria tarefa de troca e **pausa o disparo** da campanha; volta sozinho quando tudo voltar a `ok` (mín. 2).

### Etapa 9 — Integração com Tarefas + popup
- Campanha gera tarefas (revisão recorrente + exceção por card esgotado) em `pos_seller_task_instances`.
- Clique na tarefa → navega ao Modal 2 daquela campanha (passando `campanha_id` e `card_id` problemático para destacar). Popup já existente inclui essas tarefas.

---

## Detalhes técnicos
- Migrations seguem a ordem CREATE → GRANT → ENABLE RLS → POLICY; regras com `now()` via trigger, não CHECK.
- Dedup considera apenas `status IN ('enviado','entregue','lido')`; `falhou/capped` re-enfileira (não simplificar).
- Telefones casados por DDD + 8 dígitos (padrão do projeto / `phone_suffix8`).
- Nada destrutivo em tabela existente sem eu parar e perguntar antes.

## Riscos / dependências
- Bloqueante: Cloud API oficial + aprovação dos 9 templates (~24–48h, até 7 dias).
- Tier de envio Meta (Tier 0 ~250 conversas/24h) — 200/dia fica colado no piso; monitorar quality rating.
- Estoque Shopify pode divergir do físico — por isso o check é só consultivo.
