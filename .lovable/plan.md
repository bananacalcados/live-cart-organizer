## Objetivo

Criar um novo tipo de variável — **"Campo externo"** — em MARKETING → Disparos. A variável fica configurada dentro do template (junto com público e mensagem salvos como *pausado*/*agendado*), mas o **valor só é preenchido no momento em que você aperta "Disparar"**. Uso principal: link da live shopping, que só existe quando a live começa.

### Fluxo pretendido
1. Monto a mensagem, escolho o público, marco uma variável do corpo como **"Campo externo"** e dou um nome a ela (ex.: `Link da live`).
2. Salvo como **Pausado** (ou Agendado) com antecedência.
3. Na hora da live, no **Histórico de disparos**, clico em **Disparar**. Aparece um popup pedindo o valor de cada campo externo (ex.: colar o link da live).
4. O sistema injeta esse valor na variável e dispara.

---

## Como funciona hoje (base da decisão)

- Cada variável do template é guardada em `variables_config` (JSONB em `dispatch_history`) no formato `{ mode, staticValue }`.
- `mode` pode ser `__static__` (texto fixo) ou dinâmico (`__first_name__`, `__city__`, etc., que puxam do destinatário).
- Ao disparar, a função `dispatch-worker` lê `variables_config` e resolve cada variável.

A ideia se encaixa perfeitamente adicionando um novo `mode = '__external__'` — **sem mudar o banco** (o campo já é JSONB) e sem quebrar nada que já existe.

---

## Mudanças

### 1. Editor de variáveis — `src/components/marketing/MassTemplateDispatcher.tsx`
- Adicionar a opção `{ value: '__external__', label: '🔗 Campo externo (preencher ao disparar)' }` na lista de tipos de variável.
- Quando a variável estiver nesse modo, mostrar um input para **nomear o campo** (ex.: "Link da live"). Esse nome é guardado em `staticValue` (reaproveitando o campo) e será usado como rótulo do popup na hora do disparo.
- `getPreviewLabel` passa a mostrar `[🔗 Link da live]` na pré-visualização.
- O `variables_config` salvo continua idêntico em estrutura — só passa a poder conter `mode: '__external__'`.

### 2. Popup de preenchimento no disparo — `src/components/marketing/DispatchHistoryList.tsx`
- No `handleTriggerNow`, antes de acionar o envio, ler `variables_config` do disparo e detectar variáveis com `mode === '__external__'`.
- Se houver: abrir um **diálogo** listando cada campo externo (pelo nome dado) com um input.
- Ao confirmar: gravar o valor digitado em cada variável externa dentro de `variables_config` (num campo `externalValue`), atualizar o registro em `dispatch_history` e só então acionar o envio.
- Se não houver campo externo: comportamento atual, sem popup.
- A variável **continua marcada como externa** depois do disparo, então o mesmo disparo pausado pode ser reaproveitado em outra live (basta duplicar e disparar de novo, informando um link novo).

### 3. Resolução no envio — `supabase/functions/dispatch-worker/index.ts`
- Nas funções que resolvem variáveis (`resolveVariable` e os helpers de corpo/header), tratar `mode === '__external__'` retornando `externalValue` (o valor preenchido no popup), com fallback para vazio.
- Garantir que o modo externo **não** caia no ramo de texto fixo nem exija dados do destinatário (o valor é igual para todos).

---

## Segurança / não-quebra

- **Sem migração de banco** — `variables_config` já é JSONB flexível.
- Disparos e templates existentes não usam `__external__`, então nada muda para eles.
- Se um disparo com campo externo for acionado sem valor preenchido (ex.: cron de agendamento automático), a variável resolve para vazio em vez de travar o envio — mas o caminho recomendado para live é **salvar como Pausado e disparar manualmente**, que é onde o popup aparece.
- Nenhuma alteração em lógica de público, cobrança ou envio em si — apenas resolução de uma variável.

---

## Detalhes técnicos (resumo p/ referência)

| Camada | Arquivo | O que muda |
|---|---|---|
| UI config | `MassTemplateDispatcher.tsx` | Nova opção `__external__` + input de rótulo + preview |
| UI disparo | `DispatchHistoryList.tsx` | Diálogo de preenchimento no `handleTriggerNow` + update de `variables_config` |
| Envio | `dispatch-worker/index.ts` | Resolver `__external__` via `externalValue` |

Estrutura da variável externa em `variables_config`:
```text
"body_1": { "mode": "__external__", "staticValue": "Link da live", "externalValue": "https://..." }
                                     ^ nome do campo (config)        ^ valor colado no disparo
```
