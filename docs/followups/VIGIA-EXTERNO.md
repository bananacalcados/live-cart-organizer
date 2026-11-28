# Contrato do vigia externo (VPS)

- **URL:** endereço das funções do backend (valor de `VITE_SUPABASE_URL` no `.env` do projeto) + `/functions/v1/queue-health`
- **Método:** `GET`
- **Cabeçalho obrigatório:** `x-queue-watch-secret: <segredo QUEUE_WATCH_SECRET>`
- **Frequência sugerida:** a cada 2–5 min (uma leitura leve e indexada).
- Somente leitura. Nenhum dado de cliente: só contagens e tempos.

## Respostas
- `200` — corpo:
```json
{
  "ok": true,
  "generated_at": "2026-11-28T14:40:00Z",
  "overdue_minutes": 10,
  "queues": [{"queue":"live_followup_jobs","alarm":true,"overdue":0,"oldest_overdue_minutes":0,"stuck_processing":0}],
  "workers": [{"worker":"live_followup_sender","minutes_since_ok":0,"failing":false}],
  "paused_instances": 0,
  "problems": 0
}
```
  `ok=false` quando há mensagem vencida há mais de `overdue_minutes` numa fila com `alarm=true` ou o agendador/enviador está sem sucesso há mais de 5 min.
- `401` — segredo ausente ou errado.
- `503` — `QUEUE_WATCH_SECRET` ainda não cadastrado.
- `500` — consulta de saúde indisponível (o próprio vigia deve tratar como alerta).

Sugestão para a VPS: alertar se `ok=false` duas leituras seguidas, ou se a chamada falhar/demorar >15 s.
