## Objetivo

Em MARKETING → DISPAROS, permitir **dividir o público de um filtro em 2 ou mais partes** e disparar cada parte em momentos diferentes — testando o mesmo template/texto em horários distintos. Cada parte pode ter seu **próprio horário** e seu **próprio valor de campo externo** (ex.: link da live, que muda toda vez que a live cai depois de 4h no Instagram).

---

## Como eu resolvo a questão da variável externa por horário

A forma mais robusta e que **não quebra nada** é: ao dividir, o sistema cria **N disparos independentes** (um por parte), todos com o **mesmo template e as mesmas variáveis**, mudando apenas a **fatia do público**.

Por que isso resolve tudo de uma vez:

- Cada disparo tem seu próprio `variables_config` → **cada parte guarda seu próprio campo externo**.
- O popup de campo externo (que já existe) aparece **por disparo**, na hora de disparar. Então a Parte 1 pede o link da live #1, e horas depois a Parte 2 pede o link da live #2 (nova, com link novo). **Nunca precisa saber o link com antecedência.**
- O campo externo continua **dentro da campanha** (sua vantagem: evita esquecer de trocar o link), mas como são disparos separados, cada um pede o link certo no momento certo.

Regra prática que vou embutir na interface:

- Parte **sem** campo externo → pode agendar com data/hora (o cron dispara sozinho).
- Parte **com** campo externo → recomendação é salvar como **Pausada** e disparar manualmente na hora (o popup captura o link fresco). Se o usuário insistir em agendar uma parte com campo externo, aviso que o link precisa ser preenchido antes do horário, senão sai vazio.

---

## Como divido o público (para o teste ser justo)

Divisão **round-robin** por índice (`i % N`), depois de ordenar os telefones de forma estável. Assim cada parte fica com uma amostra parecida (mesma proporção de RFM/região/DDD), o que torna o teste "mesmo template em horários diferentes" comparável — em vez de cortar em blocos onde uma metade poderia concentrar um perfil.

As fatias são **disjuntas** (nenhum telefone em duas partes), então ninguém recebe duplicado.

---

## Mudanças

### 1. UI de Audiência — `MassTemplateDispatcher.tsx`
- Novo controle na área de público: **"Dividir público em N partes"** (número, padrão 1 = comportamento atual).
- Quando N > 1, mostrar um resumo: "≈ X destinatários por parte" e a lista das partes.
- Novo diálogo de **"Dividir e agendar/salvar"** (evolução do diálogo Agendar/Pausar atual): uma linha por parte, cada uma com:
  - Rótulo (Parte 1, Parte 2…),
  - Modo: **Agendar** (data/hora) ou **Pausada** (dispara manual),
  - Aviso visual quando a parte tem campo externo + modo Agendar.

### 2. Lógica de salvamento — `MassTemplateDispatcher.tsx`
- Nova função `handleSaveSplitDispatch(parts)` que reaproveita a lógica de `handleSaveScheduledOrPaused`, mas em loop:
  - Calcula as N fatias round-robin de `selectedPhones`.
  - Para cada parte: cria **1 linha em `dispatch_history`** (status `scheduled` com `scheduled_at`, ou `scheduled_paused`), com `campaign_name` sufixado `— Parte k/N`, e insere **apenas os telefones daquela fatia** em `dispatch_recipients` (mesmos lotes de 500 + upsert por índice único já existentes).
  - `variables_config`, template, header, categoria, `force_resend` idênticos em todas as partes.
- N = 1 mantém exatamente o fluxo atual (nenhuma regressão).

### 3. Disparo e resolução — **sem mudanças**
- `DispatchHistoryList.tsx`: cada parte já aparece como um disparo próprio no histórico, com botão Disparar e popup de campo externo por disparo. Nada a alterar.
- `dispatch-worker` / `dispatch-orchestrator`: cada parte é um disparo normal; agendamento e resolução de `__external__` já funcionam. **Nenhuma alteração.**

---

## Segurança / não-quebra

- **Sem migração de banco** — usa as colunas já existentes (`scheduled_at`, `status`, `variables_config`, `dispatch_recipients`).
- Fatias disjuntas + upsert por `(dispatch_id, phone)` → **zero duplicidade**.
- N = 1 é idêntico ao comportamento de hoje.
- Cada parte respeita cooldown/`force_resend` como qualquer disparo atual.
- O campo externo continua no fluxo já validado (popup no histórico), agora com um link diferente por parte.

---

## Resumo técnico

| Camada | Arquivo | O que muda |
|---|---|---|
| UI público | `MassTemplateDispatcher.tsx` | Campo "dividir em N" + diálogo com horário/modo por parte |
| Salvamento | `MassTemplateDispatcher.tsx` | `handleSaveSplitDispatch`: N linhas de `dispatch_history` + fatias round-robin em `dispatch_recipients` |
| Disparo/envio | `DispatchHistoryList.tsx`, `dispatch-worker` | Sem alteração (cada parte é um disparo normal) |
