

# Plano: Agendar e Pausar Disparos de Templates em Massa

## O que muda

Adicionar duas opções ao botão de disparo existente:
1. **Agendar** — configura template + audiência e define data/hora para disparo automático
2. **Salvar Pausado** — salva tudo configurado com status `scheduled_paused`, pronto para disparar manualmente quando quiser

## Estratégia Cirúrgica

O fluxo atual de "Disparar agora" permanece 100% intocado. As novas opções são caminhos alternativos que criam o registro em `dispatch_history` com status diferente.

---

### Passo 1 — Migração SQL

Adicionar coluna `scheduled_at` na tabela `dispatch_history`:

```sql
ALTER TABLE dispatch_history 
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
```

Nullable — disparos existentes não são afetados.

---

### Passo 2 — Edge Function: `cron-scheduled-dispatches` (NOVO)

Nova Edge Function que roda via cron (a cada minuto). Busca registros em `dispatch_history` com:
- `status = 'scheduled'`
- `scheduled_at <= now()`

Para cada um encontrado, atualiza o status para `sending` e chama `dispatch-mass-send` com o `dispatchId` — exatamente como o botão "Disparar" já faz hoje.

---

### Passo 3 — Cron Job SQL

Registrar o cron job para chamar a nova Edge Function a cada minuto (via `pg_cron` + `pg_net`).

---

### Passo 4 — Frontend: `MassTemplateDispatcher.tsx`

Mudanças cirúrgicas no componente:

1. **Novo state**: `scheduledDate` (string datetime-local)
2. **Botão de disparo**: Trocar o botão único por um grupo com 3 opções:
   - **Disparar Agora** (comportamento atual, sem mudança)
   - **Agendar Disparo** — abre um campo de data/hora, salva com `status: 'scheduled'` e `scheduled_at`
   - **Salvar Pausado** — salva com `status: 'scheduled_paused'`, sem `scheduled_at`

   Ao salvar como agendado ou pausado, o insert em `dispatch_history` é feito com os mesmos dados de hoje (template, variáveis, audiência, recipients), mas SEM chamar `dispatch-mass-send`.

3. **Toast de confirmação** ajustado para cada caso.

---

### Passo 5 — Frontend: `DispatchHistoryList.tsx`

Mudanças cirúrgicas:

1. **Badges de status**: Adicionar tratamento para `scheduled` e `scheduled_paused`:
   - `scheduled` → Badge azul com ícone de relógio + data/hora
   - `scheduled_paused` → Badge cinza "Pausado"

2. **Botão "Disparar Agora"**: Para registros com status `scheduled` ou `scheduled_paused`, exibir um botão que:
   - Atualiza o status para `sending`
   - Chama `dispatch-mass-send` (mesmo fluxo do disparo normal)

3. **Botão "Cancelar"**: Para agendados, permitir cancelar antes do envio.

---

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| Migração SQL | +1 coluna `scheduled_at` |
| `cron-scheduled-dispatches/index.ts` | Nova Edge Function (cron) |
| Cron Job SQL | Registro do cron |
| `MassTemplateDispatcher.tsx` | +3 opções no botão de disparo, +1 state |
| `DispatchHistoryList.tsx` | +2 badges, +2 botões (disparar/cancelar) |

## Garantias de Segurança

- O fluxo "Disparar Agora" não é alterado — mesmo código, mesmo caminho
- `dispatch-mass-send` não é tocado — o cron e o botão manual chamam ele da mesma forma
- Coluna nova é nullable — dados existentes intactos
- Nenhum outro módulo afetado

