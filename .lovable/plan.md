# Corrigir mistura de mensagens entre instâncias do WhatsApp

## O que está acontecendo (diagnóstico confirmado)

- **Jeanderson**: o disparo saiu pela **Ravena** (Meta) às 17:48, mas a resposta "Pode" (17:51) foi gravada na **Banana Calçados** — a instância marcada como `is_default`.
- **Karol**: a conversa se fragmentou entre **Teste centro** (uazapi) e **Whats Perola** (Z-API).
- Causa raiz no código: as 4 funções de webhook (Meta, Z-API, uazapi, WaSender) e o envio Meta têm **fallbacks silenciosos** que, quando não conseguem identificar com certeza a instância, **jogam a mensagem na instância padrão (Banana Calçados)** ou em um `?number_id=` da URL — em vez de avisar que falhou.

## Objetivo

1. **Nunca** atribuir uma mensagem à instância padrão/errada por adivinhação.
2. Quando a instância não for identificada com certeza, gravar **sem instância** e mandar para uma fila de "Não identificadas" para revisão.
3. Criar **registro permanente de roteamento** para pegar o próximo erro no flagrante.
4. **Verificar as configurações** de cada instância e entregar checklist das URLs externas.

## Mudanças no banco

### 1. Tabela `webhook_routing_log` (diagnóstico)
Grava, para cada mensagem recebida, como o roteamento foi decidido:
- `provider` (meta / zapi / uazapi / wasender)
- `sender_phone` (telefone do cliente)
- `resolution_method` (`phone_number_id` / `instanceId` / `connectedPhone` / `owner` / `token` / `query_param` / `none`)
- `resolved_whatsapp_number_id` (nulo quando falha)
- `raw_identifier` (o identificador que veio no payload, ex.: phone_number_id/instanceId)
- `matched` (boolean)
- `raw_payload` (jsonb, payload bruto)
- `created_at`

Inclui limpeza automática (registros com mais de 14 dias são apagados por uma rotina diária) para a tabela não crescer indefinidamente. RLS: leitura para usuários autenticados, escrita só via service_role (edge functions).

### 2. Marcação de "Não identificadas"
Mensagens em que a instância não pôde ser resolvida continuam sendo gravadas em `whatsapp_messages` com `whatsapp_number_id = NULL`. Será criada uma forma de listá-las para revisão (filtro "Não identificadas").

## Mudanças nas edge functions

### `meta-whatsapp-webhook`
- Resolver por `phone_number_id` (atual).
- **Adicionar 2ª chave**: se não casar por `phone_number_id`, tentar por `display_phone_number` (que também vem no payload Meta).
- **Remover o fallback para `is_default`**: se nada casar, gravar a mensagem com `whatsapp_number_id = NULL` e registrar em `webhook_routing_log` com `matched=false`.
- Registrar todas as resoluções (sucesso e falha) em `webhook_routing_log`.

### `zapi-webhook`
- Manter prioridade: `instanceId` → `connectedPhone`.
- **Rebaixar o `?number_id=`**: só usar se o payload realmente não tiver `instanceId` e `connectedPhone`. Quando cair no param, registrar como `query_param` (suspeito) no log.
- Se nada resolver, gravar com `whatsapp_number_id = NULL` em vez de adivinhar.
- Corrigir a busca por `connectedPhone` (hoje usa coluna `phone_number` que não existe na tabela; passar a casar por `phone_display`/sufixo de 8 dígitos).

### `uazapi-webhook`
- **Inverter a prioridade**: hoje o `?number_id=` da URL vence o payload. Passar a resolver primeiro por `owner` → `token`, e só usar `?number_id=` como último recurso (registrando como `query_param`).
- Sem resolução → `whatsapp_number_id = NULL` + log.

### `wasender-webhook`
- Hoje depende 100% do `?number_id=` e repassa para `zapi-webhook` sem `instanceId`. Passar a registrar em `webhook_routing_log` quando o `number_id` estiver ausente/forçado, para flagrar configuração errada.

### Envio Meta (`meta-whatsapp-send`, `meta-template-send`, `meta-whatsapp-send-template`)
- Quando o chamador **especifica** `whatsapp_number_id` mas ele está inativo/não encontrado, **falhar com erro claro** em vez de cair silenciosamente na instância padrão (isso evita disparo sair por número errado, gerando resposta na instância errada). O fallback para padrão continua válido **apenas** quando nenhum instância é informada.

## Verificação de configuração (entregue como checklist + checagem automática)

- Script de verificação que aponta instâncias ativas com identificadores faltando:
  - Meta sem `phone_number_id`
  - Z-API sem `zapi_instance_id`
  - uazapi sem `uazapi_owner`/`uazapi_token`
  - WaSender sem `wasender_session_id`
- Checklist das URLs de webhook que precisam estar com o identificador correto **por instância** nos painéis externos (Z-API, uazapi, Meta), já que o roteamento por payload só funciona se a instância estiver corretamente conectada e enviando seu próprio identificador.

## Como vamos validar

1. Disparar mensagens de teste e conferir em `webhook_routing_log` que cada uma resolveu pelo método forte (`phone_number_id`/`instanceId`/`owner`) e não pelo `query_param`.
2. Confirmar que mensagens sem instância resolvível aparecem como "Não identificadas" (e não mais na Banana Calçados).
3. Monitorar o log por alguns dias para identificar instâncias mal configuradas e corrigir as URLs externas com base no checklist.

## Notas técnicas

- Nenhuma mensagem existente é alterada; a correção vale para mensagens novas.
- A regra de memória "Conversa = (telefone+instância)" é reforçada: a instância passa a vir sempre do identificador real do payload, nunca de adivinhação.
