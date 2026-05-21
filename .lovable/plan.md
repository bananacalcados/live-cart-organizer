# Plano: Otimização DB (C, D, E) + Medição (F, G)

## Contexto verificado
- `whatsapp_messages`: 316 MB, 232k linhas, na publication realtime
- 55 tabelas na `supabase_realtime` (muitas desnecessárias)
- 52 arquivos no frontend usando `.channel(...)`, ~67 subscrições sem filtro server-side vs 51 com filtro
- Sistemas críticos a preservar: `dispatch-mass-send`, `cron-scheduled-dispatches`, `automation-dispatch-audience`, `cron-automation-timeouts`, `meta-whatsapp-webhook`, módulo PDV chat

---

## C. Realtime seletivo (BAIXO RISCO)

**Objetivo:** reduzir tráfego realtime sem mexer em business logic.

**Passo 1 — Auditoria da publication (migration):**
Remover da `supabase_realtime` as tabelas que NÃO são lidas via realtime no frontend hoje (somente leituras pontuais via select). Candidatas a remover, com base na lista atual:
- `zoppy_customers`, `zoppy_sales` (Zoppy desativado)
- `marketing_send_logs`, `marketing_campaigns` (consulta on-demand)
- `bank_transactions`, `fiscal_documents` (admin, sem listeners)
- `paypal_payments` (sem listeners)
- `whatsapp_groups`, `whatsapp_numbers` (config; sem listener crítico)
- `event_stock_alerts`, `inventory_correction_queue`, `inventory_count_items`, `inventory_counts`, `inventory_unresolved_barcodes` (revisar caso a caso)
- `live_viewers`, `live_comments` (alto volume; avaliar se algum overlay depende)

**Antes de remover cada tabela** vou rodar `rg "table: '<nome>'"` para confirmar que nenhum `.channel().on('postgres_changes', { table: ... })` ainda escuta. Só remove se zero matches.

**Passo 2 — Documentar regra:** memória de projeto pedindo `filter:` sempre que possível (`phone=eq.X`, `tenant_id=eq.X`).

**Não vou:** reescrever os 67 listeners hoje — risco de regressão alto. Apenas documentação + auditoria de publication.

**Risco de quebra:** zero se a auditoria for conservadora (só remove o que tem 0 listeners). PDV chat, dispatch e automação não são afetados.

---

## D. Particionar `whatsapp_messages` (MÉDIO RISCO — feito com cuidado)

**Por que vale:** 316 MB hoje, cresce ~30-50MB/mês. Particionar por mês permite drop de partições antigas sem locks longos e queries por janela temporal ficam mais rápidas.

**Estratégia segura (zero downtime):**

1. **Criar tabela nova particionada** `whatsapp_messages_new` (PARTITION BY RANGE em `created_at`), com mesmas colunas + índices + RLS + triggers.
2. **Criar partições:** uma por mês cobrindo histórico (2024-01 até 2027-12) + `_default`.
3. **Copiar dados** em lotes (INSERT … SELECT por janela de 1 mês para não estourar memória).
4. **Swap atômico:**
   ```sql
   BEGIN;
   ALTER TABLE whatsapp_messages RENAME TO whatsapp_messages_old;
   ALTER TABLE whatsapp_messages_new RENAME TO whatsapp_messages;
   COMMIT;
   ```
5. **Recriar publication realtime** apontando para a nova tabela.
6. **Validar 24-48h** que webhooks, PDV chat, automação continuam gravando/lendo. `whatsapp_messages_old` mantida intacta como rollback.
7. **Cron de manutenção:** criar partição do próximo mês automaticamente (pg_cron mensal).

**Compatibilidade:** estrutura idêntica → código frontend, edge functions (`meta-whatsapp-webhook`, `zapi-receive-message`, `dispatch-mass-send`, etc.) continua funcionando sem mudança.

**Risco de quebra dispatch/automação:** mitigado pelo swap atômico + tabela `_old` preservada. Se algo quebrar, rollback é 1 RENAME.

**Pré-requisito que vou confirmar antes:** se existem FKs apontando para `whatsapp_messages.id` (particionamento exige PK incluir `created_at`). Se sim, ajustamos a estratégia.

---

## E. Fila de broadcasts (BAIXO-MÉDIO RISCO)

**Estado atual:** `dispatch-mass-send` processa em chains de timeout 150s, com `processing_batch` lock + recovery via `cron-scheduled-dispatches` (45s threshold). Funciona, mas é frágil.

**Mudança proposta — incremental, não substitutiva:**

1. **Nova tabela `broadcast_queue`** (já existe parecido em `dispatch_recipients`? Vou confirmar):
   - `dispatch_id`, `phone`, `payload jsonb`, `status` (pending/sending/sent/failed), `attempts`, `locked_until`, `scheduled_at`
   - Índice parcial em `(status, scheduled_at) WHERE status='pending'`

2. **Worker dedicado** `broadcast-queue-worker`:
   - Pega N=20 mensagens com SELECT … FOR UPDATE SKIP LOCKED
   - Envia respeitando rate-limit Meta atual (já existe em `mass-dispatch-throttling-and-logging`)
   - Re-enfileira em erro 429/5xx com backoff

3. **`dispatch-mass-send` mantido**, mas em vez de processar inline ele apenas:
   - Resolve audiência (já faz)
   - Insere em `broadcast_queue`
   - Marca dispatch como `queued`

4. **Cron atual `cron-scheduled-dispatches`** vira disparador do worker (a cada 30s).

**Por que não quebra:**
- Audiência, dedup, cooldown 14d, filtros — toda a lógica de `automation-dispatch-audience` e `dispatch-mass-send` permanece intacta.
- Rate-limit Meta já existente continua sendo a régua.
- Recovery de jobs órfãos fica mais simples (basta resetar `locked_until`).

**Migração:** plano em 2 fases — primeiro deploya worker em paralelo, dispara 1 broadcast de teste pela fila, valida, depois corta o caminho antigo.

---

## F. Read replicas — MEDIR PRIMEIRO

**Antes de habilitar (custa ~$50-100/mês no Supabase Pro+):**

Vou rodar query em `pg_stat_statements` para identificar:
- Top 20 queries por `total_exec_time`
- Quais vêm de dashboards (POS metrics, ABC curve, inventory)
- % de tempo do CPU master gasto em read pesado vs write

**Decisão:** só recomenda replica se >30% do tempo do master for em queries de dashboard read-only. Senão, não compensa.

**Entregável:** relatório com top queries + recomendação custo/benefício.

---

## G. Cache edge (Upstash) — MEDIR PRIMEIRO

**Comparação de custo:**
- Lovable Cloud upgrade (instance Medium → Large): preciso que você me confirme o delta de preço no painel Backend → Advanced Settings.
- Upstash Redis pago: ~$10/mês (10k cmd/dia free; pago a partir disso ~$0.20 por 100k commands).

**Métrica para decidir:** vou medir nos logs das edge functions (`meta-whatsapp-webhook`, `zapi-receive-message`) quantas queries idênticas/min consultam `whatsapp_numbers`, `whatsapp_instances` etc. Se >500/min de queries cacheáveis → Upstash compensa. Se <100/min → upgrade Lovable é mais simples.

**Entregável:** tabela de comparação custo × ganho estimado.

---

## Ordem de execução

1. **C-passo 1** (auditoria publication) — 1 migration, baixo risco
2. **F + G — medição** (read-only queries + leitura de logs) → relatório
3. **E** (fila broadcast em paralelo, com fallback)
4. **D** (particionamento, janela de baixo tráfego — domingo madrugada)

Cada etapa eu valido logs/contagens antes de seguir para a próxima. Posso confirmar?
