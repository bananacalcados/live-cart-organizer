# Redesign do Disparador de Grupos VIPs — Estilo Humano Real

## Nova lógica de disparo (round-robin por bloco)

Em vez de "todos os blocos de um grupo, depois próximo grupo", invertemos:

```
Bloco 1 → Grupo A   [delay entre blocos: 8–15s]
Bloco 2 → Grupo A   [delay entre blocos: 8–15s]
Bloco 3 → Grupo A   [delay entre GRUPOS: 45–90s]
Bloco 1 → Grupo B   [delay entre blocos: 8–15s]
Bloco 2 → Grupo B
...
[a cada 3 grupos completos: pausa longa 120–180s]
```

Ou seja: **sequencial puro, 1 mensagem por vez para a Meta**, exatamente como um humano faria. Nada de paralelismo, nada de rajada simultânea.

## Tolerância a falhas

- Se um bloco falhar em um grupo: **retry 1x naquele mesmo grupo/bloco** (após 10s).
- Se falhar de novo: marca aquele bloco/grupo como `failed`, **pula pro próximo bloco do mesmo grupo** (não interrompe a campanha).
- Ao final: relatório completo com lista `{grupo, bloco, erro, tentativas}` para reenvio manual seletivo.

## Persistência (nova tabela)

`group_campaign_block_dispatches`:
- `campaign_id`, `group_db_id`, `group_id` (whatsapp), `group_name`
- `block_index` (ordem do bloco na campanha), `block_type` (text/image/audio/poll), `content`/`media_url`/`caption`
- `status` (pending/sent/failed), `attempts`, `error_message`, `sent_at`, `whatsapp_number_id`

Permite ver no painel exatamente o que falhou onde, e ter botão **"Reenviar apenas falhas"** que cria uma nova execução só dos `failed`.

## Defaults de delays

- Entre blocos do mesmo grupo: **8–15s aleatório**
- Entre grupos (após último bloco): **45–90s aleatório**
- A cada **3 grupos**: pausa longa **120–180s**
- Modo único: **SLOW** (remove fast/medium da UI).

## Status online/offline das instâncias Z-API

1. Nova edge function `zapi-instance-health-check`: itera todas as instâncias ativas, chama `/status` da Z-API, atualiza `whatsapp_numbers.is_online` e `last_health_check`.
2. Cron a cada **2 minutos**.
3. UI: badge verde "🟢 Online" / vermelho "🔴 Offline" ao lado do nome da instância no:
   - Seletor de instância (Grupos VIPs, Chat, etc.)
   - `ZApiInstanceManager` (admin)
4. Ao tentar enviar por instância offline: **bloqueia antes da chamada** com toast claro "Instância X está desconectada. Reconecte ou escolha outra."

## Migração de schema

```sql
ALTER TABLE whatsapp_numbers
  ADD COLUMN is_online BOOLEAN DEFAULT NULL,
  ADD COLUMN last_health_check TIMESTAMPTZ;

CREATE TABLE group_campaign_block_dispatches (...);
-- GRANTs + RLS para authenticated/service_role
-- Index em (campaign_id, status), (campaign_id, group_db_id, block_index)
```

## Arquivos a tocar

**Backend:**
- `supabase/migrations/...` — nova tabela + colunas em whatsapp_numbers
- `supabase/functions/zapi-instance-health-check/index.ts` (nova)
- `supabase/functions/zapi-group-campaign-execute/index.ts` — reescrever lógica round-robin por bloco + retry + health-check antes de enviar
- Cron via `supabase--insert` (pg_cron a cada 2min)

**Frontend:**
- `src/components/marketing/` — painel de campanha VIP: remover seletor de velocidade, mostrar progresso por bloco/grupo, botão "Reenviar falhas"
- `src/components/admin/ZApiInstanceManager.tsx` — badge online/offline
- Seletor de instância nos disparos — badge + bloqueio se offline

## Pontos abertos para confirmar

1. **Retry**: 1 retry é suficiente, ou prefere 2?
2. **Pausa longa a cada 3 grupos**: confirmar 120–180s aleatório.
3. **Bloco do tipo enquete (poll)**: confirmar se o Z-API que vocês usam suporta envio de poll em grupo (ou se tratamos como texto formatado).
4. **Health-check Z-API**: ok rodar a cada 2 minutos? (custo: 1 chamada por instância a cada 2min, irrelevante.)
