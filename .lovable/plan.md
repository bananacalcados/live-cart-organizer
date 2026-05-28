# Refatoração do Motor de Disparo em Massa

## Problema atual
O disparo hoje depende de uma **cadeia recursiva de Edge Functions** (uma chama a próxima via HTTP). Quando qualquer chamada falha, atrasa ou estoura timeout, a cadeia quebra e o disparo trava — exigindo "orphan recovery" via cron a cada poucos minutos. Resultado: disparos lentos, com gaps e travamentos recorrentes.

## Solução: Worker assíncrono com lock no banco

Trocar o modelo "função chama função" por um modelo **fila + workers concorrentes + lease lock**, padrão usado por sistemas de jobs robustos (Sidekiq, BullMQ, Inngest).

### Arquitetura

```text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Frontend cria   │──▶ │ dispatch_history │ ◀──│ Cron a cada 30s │
│ dispatch        │    │ status=pending   │    │ aciona workers  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                  ┌──────────────────────────┐
                  │ dispatch_jobs (fila)     │
                  │ • dispatch_id            │
                  │ • contact_id             │
                  │ • status (pending/       │
                  │   leased/sent/failed)    │
                  │ • lease_until            │
                  │ • attempts               │
                  └──────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
        Worker 1          Worker 2          Worker N
       (Edge Fn)         (Edge Fn)         (Edge Fn)
            │                 │                 │
            └─────────────────┴─────────────────┘
                              ▼
                       Meta / Z-API
```

## Componentes

### 1. Tabela `dispatch_jobs` (nova)
Uma linha por destinatário. Substitui o estado implícito que hoje vive em vários lugares.
- Campos: `dispatch_id`, `phone`, `contact_id`, `payload (jsonb)`, `status`, `lease_until`, `worker_id`, `attempts`, `last_error`, `sent_at`
- Índice em `(status, lease_until)` para o claim ser O(log n)

### 2. Função SQL `claim_dispatch_jobs(worker_id, batch_size)`
- `SELECT ... FOR UPDATE SKIP LOCKED` (padrão de fila no Postgres)
- Marca lote como `leased` com `lease_until = now() + 60s`
- Garante que **dois workers nunca pegam o mesmo job** sem precisar de locks aplicacionais

### 3. Edge Function `dispatch-worker` (nova)
- Roda em loop interno por até 50s (limite seguro abaixo do timeout)
- A cada iteração: claim 20 jobs → envia em paralelo → marca como `sent`/`failed`
- Se um envio falha, incrementa `attempts`; após 3 tentativas marca como `failed` permanente
- Não chama a si mesma. Não chama outras funções. Só faz envio.

### 4. Cron `dispatch-orchestrator` (a cada 30s)
- Verifica quantos disparos têm jobs pendentes
- Dispara **N workers em paralelo** via `pg_net.http_post` (fire-and-forget)
- N proporcional à fila pendente (ex: 1 worker por 200 jobs, máx 10)
- Como worker tem lease, mesmo se o cron dispara workers demais, eles competem sem duplicar envio

### 5. Função `enqueue_dispatch_jobs(dispatch_id)`
Chamada quando frontend cria disparo. Faz `INSERT ... SELECT` em massa de `dispatch_targets` → `dispatch_jobs`. Operação única no banco, sem HTTP.

### 6. Limpeza dos caminhos antigos
- Remove a cadeia recursiva de `dispatch-mass-send` (chamar próximo lote)
- Remove "orphan recovery" do cron — não é mais necessário
- `vps-dispatch-proxy` continua existindo apenas como atalho do frontend para enfileirar

## Por que isso é definitivo

| Causa de travamento hoje | Como o novo modelo resolve |
|---|---|
| Função A chama B via HTTP e B demora | Não existe mais cadeia; cada worker é independente |
| Worker morre no meio do lote | Lease expira em 60s, outro worker pega os jobs órfãos |
| Cron de "orphan recovery" cria sobreposição | SKIP LOCKED impede que dois workers peguem o mesmo job |
| UI precisa estar aberta | Cron roda no banco, independe do frontend |
| Polling de count() pesado | UI lê só `dispatch_history` (1 row) |

## Plano de execução

1. **Migração SQL**: criar `dispatch_jobs`, índices, função `claim_dispatch_jobs`, função `enqueue_dispatch_jobs`
2. **Edge Function `dispatch-worker`**: loop com claim → envio Meta/Z-API → mark done
3. **Edge Function `dispatch-orchestrator`** + cron pg_cron a cada 30s
4. **Refatorar `vps-dispatch-proxy`**: passa a só chamar `enqueue_dispatch_jobs` + acordar 1 worker imediatamente
5. **Aposentar lógica recursiva** em `dispatch-mass-send` (mantém função só para compat de envio individual se ainda usada)
6. **Backfill do disparo atual** (`32b74cf9...`): script que move os ~4.474 pendentes pra `dispatch_jobs` para já se beneficiar do novo motor
7. **Validação**: rodar um disparo de teste pequeno e medir throughput; ajustar concorrência

## Detalhes técnicos chave

- `FOR UPDATE SKIP LOCKED` no claim — sem deadlock, sem duplicação
- Workers usam `Promise.allSettled` em batches de 20 (respeita rate-limit Meta de ~80/s)
- Backoff exponencial entre attempts (1min, 5min, 15min)
- `lease_until` permite recuperação automática sem cron de recovery
- Throughput esperado: 10 workers × 20 jobs × 2s/lote ≈ **100 envios/s sustentado** (vs ~10-15/s hoje com gaps)

## Fora de escopo
- Não toco em UI do MassTemplateDispatcher além do que já foi feito
- Não toco em lógicas de segmentação, cooldown ou filtros de público
- Não toco em outras automações (broadcast VIP, follow-up, etc) — só no motor de envio em massa
