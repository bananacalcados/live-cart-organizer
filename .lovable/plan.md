## Objetivo

Permitir que campanhas de Grupos VIP sejam enviadas tanto via **Z-API** quanto via **WaSender**, escolhendo automaticamente o canal conforme o `provider` da instância (`whatsapp_numbers`) — **sem alterar** a lógica de disparo humano.

## Regra de disparo (preservada exatamente)

A cadência atual já segue sua regra e será mantida sem mudanças:
- Cada **bloco** de mensagem é um disparo independente.
- Delay entre blocos: 8–15s.
- Só passa para o **próximo grupo** depois de terminar **todos os blocos** do grupo atual.
- Delay entre grupos: 45–90s (depois de concluir o grupo anterior).
- Pausa longa de 120–180s a cada 3 grupos completos.
- Retry de 1x após 10s por bloco que falhar; falhou de novo → marca o bloco como `failed` e segue.

```text
Grupo A: Bloco1 -> (delay 8-15s) -> Bloco2 -> (delay) -> Bloco3
         -> (delay 45-90s entre grupos)
Grupo B: Bloco1 -> (delay) -> Bloco2 ...
         -> (a cada 3 grupos: pausa 120-180s)
```

Nada nesse loop muda. A única alteração é **para onde** cada bloco é enviado.

## O que muda

### 1. `supabase/functions/zapi-group-scheduled-send/index.ts`
- Carregar o `provider` da instância resolvida (`resolvedNumberId`) uma vez no início (já buscamos `whatsapp_numbers` na validação de online — incluir `provider` ali).
- Em `sendBlockOnce`, rotear conforme o provider:
  - **zapi** → continua chamando `zapi-send-group-message` (comportamento atual, inalterado).
  - **wasender** → chamar as funções WaSender correspondentes, passando o **JID do grupo** (`group.group_id`) como `to`/`phone` e o `whatsapp_number_id`:
    - texto → `wasender-groups` (action `sendMessage`, com `mentions` quando `mention_all`) ou `wasender-send-message`.
    - imagem/vídeo/áudio/documento → `wasender-send-media`.
    - enquete (poll) → `wasender-send-extra` (kind `poll`).
- Normalizar a resposta de sucesso/erro das funções WaSender para o mesmo formato `{ ok, error }` que o loop já espera (sem tocar no retry/delays).

### 2. Validação de instância online (multi-provider)
- O bloco atual só aborta quando `provider === 'zapi' && is_online === false`. Para WaSender, manter o envio normalmente (a checagem de saúde Z-API não se aplica). Sem checagem extra nesta rodada — se a sessão WaSender estiver desconectada, o próprio erro de envio aciona o retry/`failed` já existente.

### 3. Menções "todos" em grupo (mention_all)
- WaSender: usar `wasender-groups` action `sendMessage` com `mentions` (já suportado pela função). Quando `mention_all` estiver ativo e não houver lista pronta, enviar sem mentions (fallback seguro) para não travar o disparo.

## Detalhes técnicos

- A função `wasender-send-message`/`wasender-send-media`/`wasender-send-extra` já preservam JIDs de grupo (`@g.us`, `120...`) intactos em `formatPhone`, então o mesmo `group.group_id` usado pela Z-API funciona como destino.
- `instance-guard` não bloqueia grupos (já há bypass para `isGroupId`), então os envios em grupo passam sem conflito de instância.
- O `group-send-guard` (pausa global de grupos) continua respeitado, pois vive no loop principal, não no envio.
- Tracking em `group_campaign_block_dispatches` permanece igual (status/attempts/error por bloco), independente do provider.

## Fora de escopo

- UI de seleção de provider para grupos (a campanha já resolve a instância via `whatsapp_number_id`/`campaign.whatsapp_number_id`).
- Sincronização da lista de grupos WaSender (já coberta por `wasender-groups` action `list`, se necessário em rodada futura).

## Validação

- Deploy de `zapi-group-scheduled-send`.
- Testar uma campanha de teste apontando para instância WaSender com 2+ grupos e 2+ blocos, confirmando nos logs: blocos sequenciais com delay, troca de grupo só após último bloco, delay entre grupos, e registros em `group_campaign_block_dispatches`.
- Confirmar que campanhas em instância Z-API continuam idênticas.
