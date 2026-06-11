# Plano: Sistema de Tarefas + Pop-up de Lembrete por Vendedora

Análise do sistema atual e plano para implementar sem quebrar nada.

## O que já existe (reaproveitar)
- **Seleção de vendedora já acontece nos dois lugares:** `POSSellerGate` (ao entrar em Vendas, em `POSSalesView`) e `POSWhatsAppSellerGate` (ao entrar no chat, em `POSWhatsApp`, persistido em `sessionStorage`). Vamos **pendurar o novo pop-up logo após essas seleções** — sem mexer no fluxo de venda.
- **Tabela `pos_seller_tasks`** já existe (tarefas de contato com cliente, RFM, pontos, `status`, `completed_at`). Hoje é usada em `POSConfig` (gera lista de clientes p/ contato) e `POSDashboard`. Vamos **estender o conceito**, não substituir.
- **Disparo de template Meta** já existe: `meta-template-send`, `meta-whatsapp-send-template`, fila `meta_message_queue`, e vários crons (`cron-send-scheduled-messages`, etc.). Vamos seguir esse padrão.
- **Fontes de dados para auto-tarefas** já existem: `customers_unified` (RFM/clientes antigos), leads de WhatsApp (chat), `whatsapp_status_posts` (status), grupos VIP.

## Parte 1 — Banco de dados (migração nova)

### A) `pos_sellers`: novas colunas
- `is_manager boolean default false` — gerente vê tarefas das outras.
- `whatsapp_phone text` — número pessoal para receber os disparos de template.

### B) `pos_task_definitions` (o que é configurado no Dashboard Geral)
Campos principais:
- `store_id`, `title`, `description`, `category` (ex.: `contact_old_customers`, `post_sale`, `vip_capture`, `status_upload`, `cold_leads`, `som_car`, `size_offer`, `vip_post`, `conditional`, `referrals`, `google_reviews`, `custom`).
- `verification_mode`: `manual` (vendedora só marca) ou `auto` (sistema confirma via ação real).
- `target_count int` (ex.: 5 clientes / 5 leads / 5 indicações).
- `recurrence`: `once` | `daily` | `weekly` | `weekly_specific` | `monthly` | `monthly_specific`.
- `recurrence_config jsonb` (data única, dia da semana, semana do mês, mês específico, etc.).
- `assignment`: `all` | `managers` | `specific`; + `assigned_seller_ids uuid[]`.
- `points_reward`, `is_active`, `auto_config jsonb` (parâmetros da geração automática: segmento RFM, janela de dias dos leads, etc.).

### C) `pos_seller_task_instances` (instâncias por vendedora/dia)
Geradas a partir das definições para cada vendedora no dia/período válido:
- `definition_id`, `seller_id`, `store_id`, `due_date`.
- `status`: `pending` | `completed`.
- `progress_current int` / `progress_target int` (ex.: 3/5).
- `completed_at`, `completion_mode` (`manual`/`auto`), `payload jsonb` (a lista gerada — 5 clientes, 5 leads, etc.).

### D) `pos_task_contacts` (itens verificáveis das auto-tarefas)
Um registro por cliente/lead da lista de uma instância:
- `instance_id`, `customer_phone`, `customer_name`, `contacted boolean`, `contacted_at`.
- Marcar `contacted=true` quando a vendedora **realmente enviar** a mensagem pelo WhatsApp integrado → ao bater o `target_count`, a instância vira `completed` automaticamente.

### E) `pos_task_dispatch_schedules` (disparos de template no WhatsApp pessoal)
- `store_id`, `template_name`, `template_variables jsonb` (mapeamento de variáveis, incluindo a variável especial `{{tarefas_do_dia}}`).
- `target`: `all_sellers` | `managers`.
- `send_times time[]` (vários horários por dia; gerentes podem ter mais horários).
- `is_active`.

Todas as tabelas com GRANTs corretos (`authenticated` + `service_role`) e RLS.

## Parte 2 — Pop-up de Lembrete (PDV)

Novo componente `SellerTaskReminderPopup.tsx`:
- **Modal grande, central, que incomoda** (overlay escuro, `max-w-2xl`, impede fechar clicando fora).
- Lista as instâncias de tarefa do dia da vendedora logada, cada uma com **checkbox**.
- **Tarefas manuais:** checkbox marca como concluída direto.
- **Tarefas auto-verificadas:** mostram a lista gerada (ex.: 5 clientes) + **botão "Enviar no WhatsApp"** por contato (abre o chat já carregado, via `POSTaskWhatsAppDialog`). Checkbox bloqueado; a barra de progresso (3/5) só fecha quando as mensagens forem realmente enviadas.
- Botão **"VOU REALIZAR AINDA"** fecha o pop-up sem concluir.
- **Gatilhos:** abre após a seleção de vendedora em `POSSellerGate` (Vendas) e em `POSWhatsAppSellerGate` (chat). Anti-irritação: reabre 1x por turno/sessão se ainda houver pendências (configurável).
- **Gerente:** vê uma aba extra com as tarefas/progresso das outras vendedoras + atalho para métricas (já existe `POSSellerDashboard`).

## Parte 3 — Configuração no Dashboard Geral (com senha 3021)

Em `POSGeneralDashboard.tsx`, adicionar uma seção/botão **"Tarefas das Vendedoras"** protegida por senha **3021** (gate client-side simples; libera por sessão). Dentro dela:
1. **CRUD de definições de tarefa** (Parte 1B): título, categoria, modo de verificação, recorrência (dia único / semanal / semana específica / mensal / mês específico), atribuição (todas / específicas / gerentes), meta e pontos.
2. **Vendedoras:** marcar `is_manager` e cadastrar `whatsapp_phone`.
3. **Disparos de template:** selecionar template do WhatsApp API, mapear variáveis (incluindo `{{tarefas_do_dia}}`), definir horários (vários por dia) e público (todas / gerentes com mais frequência).

## Parte 4 — Geração e verificação automática

- **Cron de geração diária** (`pos-tasks-generate-cron`): a cada manhã cria as `pos_seller_task_instances` das definições ativas válidas para o dia. Para auto-tarefas, monta o `payload` e os `pos_task_contacts`:
  - *5 clientes antigos:* puxa de `customers_unified` por RFM/última compra.
  - *Pós-venda dia anterior:* clientes das `pos_sales` de ontem.
  - *5 leads frios (7 dias):* leads de WhatsApp sem compra na janela.
  - *Status/VIP/etc.:* metas com verificação própria (status via `whatsapp_status_posts`).
- **Verificação real:** ao enviar mensagem pelo WhatsApp integrado a partir do pop-up, marca o `pos_task_contacts.contacted` e incrementa o progresso; ao bater a meta, conclui a instância (sem depender da palavra da vendedora). Status conta posts publicados; VIP conta entradas no grupo; etc.
- **Tarefas manuais** permanecem com conclusão por checkbox.

## Parte 5 — Disparo de template no WhatsApp pessoal

- Novo cron `pos-task-dispatch-cron` (segue `cron-send-scheduled-messages`): nos horários configurados, para cada vendedora/gerente alvo, monta a string `tarefas_do_dia` (lista das pendências da pessoa) e dispara o template via `meta-template-send`.
- Suporta **vários disparos por dia** e **mais frequência para gerentes**.

## Detalhes técnicos / segurança
- Senha 3021: gate de UI por sessão; **não** é controle de acesso real (dados continuam protegidos por RLS por loja). Se quiser segurança forte depois, migramos para senha no servidor.
- Verificação anti-burla: conclusão automática só por **ação registrada** (mensagem enviada, status publicado), não por clique.
- Sem alterar o fluxo de venda nem o envio de mensagens existente — só adicionamos hooks/listeners.
- Arquivos novos: migração; `SellerTaskReminderPopup.tsx`; seção de config no Dashboard Geral; hook `useSellerTasks.ts`; crons `pos-tasks-generate-cron` e `pos-task-dispatch-cron`.
- Arquivos tocados: `POSSalesView.tsx` e `POSWhatsApp.tsx` (abrir o pop-up pós-seleção), `POSGeneralDashboard.tsx` (config), `pos_sellers` (colunas novas).

## Fases de entrega sugeridas
1. Migração + colunas (`is_manager`, `whatsapp_phone`) + tabelas novas.
2. Config no Dashboard Geral (senha 3021, CRUD de definições, gerente, números).
3. Pop-up central + gatilhos pós-seleção (manual primeiro).
4. Geração automática + verificação real (5 clientes, pós-venda, leads, status).
5. Disparo de template com variável `{{tarefas_do_dia}}` e múltiplos horários.
