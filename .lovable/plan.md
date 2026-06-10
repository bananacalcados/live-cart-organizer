# Migração Z-API → uazapi: Whats Pérola

## Situação atual (confirmada no banco)

Mesmo número físico (`33991208852`) existe em duas linhas:

| Linha | provider | id | estado | mensagens |
|---|---|---|---|---|
| **Whats Perola** (Z-API) | zapi | `72e1beb5-…f306de0` | ativo + online | **10.579** |
| **Whats Pérola** (uazapi) | uazapi | `0833dc6c-…5993e9c` | ativo, **offline** | 0 |

A instância uazapi já tem `uazapi_owner = r5cabd36dc18935` (chave forte distinta da Centro, que é `r6faac8e5a7676a`).

Como funciona hoje (importante para a estratégia):
- `whatsapp_messages` é a fonte do histórico, vinculada por `whatsapp_number_id`.
- O front (`useChatMessages`) carrega o histórico filtrando por `phone` + `whatsapp_number_id`.
- A instância de envio de uma conversa vem da **última mensagem** daquele telefone (`useConversationInstance`), nunca do seletor global.
- O `uazapi-webhook` resolve a instância por **chave forte**: `owner` → `token` → (último recurso) `?number_id=`. Cada instância uazapi tem `owner` único, então Pérola e Centro não colidem desde que cada webhook envie seu próprio `owner`.

Conclusão central: **migrar = reatribuir o `whatsapp_number_id` das 10.579 mensagens da linha Z-API para a linha uazapi.** Isso preserva 100% do histórico, e como o binding de conversa segue a última mensagem, todas as conversas passam automaticamente a "pertencer" à instância uazapi.

---

## Fases

### Fase 0 — Backup e verificação (antes de tocar em nada)
1. Exportar um snapshot CSV das mensagens da linha Z-API Pérola (`whatsapp_number_id = 72e1beb5…`) para `/mnt/documents/` — rede de segurança para rollback.
2. Conferir contagem exata e o range de datas para validar depois (`count(*)`, `min/max(created_at)`).
3. Registrar o mapeamento dos dois ids (origem zapi → destino uazapi).

### Fase 1 — Conectar e blindar a instância uazapi Pérola
1. Conectar a instância uazapi "Whats Pérola" via QR (hoje está **Offline**). Sem isso, nada novo chega.
2. Configurar o **webhook da instância** no uazapi apontando para `uazapi-webhook` (com `?number_id=0833dc6c…` apenas como fallback — a identificação real é por `owner`).
3. Validar que o payload real traz `owner = r5cabd36dc18935`. Confirmar enviando 1 mensagem de teste do seu número pessoal e checando em `webhook_routing_log` que a resolução foi por `method=owner` e caiu na linha Pérola (não Centro).
4. Reativar IA só depois (a instância nasce com IA pausada por aquecimento — manter pausada até validar roteamento).

### Fase 2 — Evitar duplicação (ponto crítico)
O WhatsApp multidevice permite Z-API e uazapi conectados ao mesmo tempo. Se ambos ficarem online, **as duas webhooks disparam** e a mesma mensagem entra duas vezes.
1. **Desconectar/derrubar a sessão Z-API** "Whats Perola" assim que o uazapi estiver online e validado.
2. Marcar a linha Z-API como `is_active = false` (igual já foi feito com a "Whats Centro" zapi). Isso também faz o webhook do uazapi tratar qualquer match acidental na linha zapi como "não identificada", nunca atribuir errado.
3. Manter a linha Z-API no banco (não deletar) até o fim da validação, para permitir rollback.

### Fase 3 — Migração do histórico
1. Em migration (UPDATE), reatribuir o histórico:
   `whatsapp_messages.whatsapp_number_id`: de `72e1beb5…` → `0833dc6c…`.
2. Reatribuir tabelas de binding de conversa que referenciam a instância antiga, para o chat não "perder" a vinculação:
   - `chat_conversation_assignments` / `chat_assignments` (se tiverem `whatsapp_number_id`).
   - quaisquer follow-ups/agendamentos pendentes com `whatsapp_number_id` da linha zapi.
   (Vou inventariar todas as colunas `whatsapp_number_id` que apontam para a linha zapi antes de escrever o UPDATE, para não deixar resíduo.)
3. Rodar em **transação única** com `WHERE whatsapp_number_id = '72e1beb5…'` e validar a contagem afetada == 10.579 antes de confirmar.

### Fase 4 — Validação pós-migração
1. Abrir no PDV/Chat uma conversa antiga da Pérola e confirmar que o histórico completo aparece sob a instância uazapi.
2. Confirmar via `useConversationInstance` que o envio sai pela instância uazapi (não pede seletor global).
3. Enviar/receber 1 mensagem real e confirmar que entra na Pérola e **não** na Centro (`webhook_routing_log`).
4. Conferir que nenhuma mensagem ficou órfã na linha zapi (`count = 0`).

---

## Pontos de erro previstos e mitigação

1. **Duplicação por dupla conexão (maior risco).** Mitigação: só migrar/abrir uazapi depois de derrubar a sessão Z-API; dedup do webhook por `message_id` ajuda, mas a regra principal é uma sessão ativa por vez.
2. **Vazamento Pérola ↔ Centro.** Mitigação: identificação por `owner` (chave forte única por instância) já implementada; o `?number_id=` é só fallback. Validar no `webhook_routing_log` que `method=owner`. Nunca confiar só no query param.
3. **Webhook do uazapi não configurado / sem owner no payload.** Mitigação: testar 1 mensagem e inspecionar o log antes de desligar a Z-API.
4. **Conversas "somem" após migração.** Causa seria binding residual apontando para a linha zapi. Mitigação: migrar também as tabelas de assignment/follow-up no mesmo passo.
5. **9º dígito / formato de telefone divergente entre Z-API e uazapi.** Ambos já normalizam para E.164 com injeção do 9º dígito; risco baixo, mas a validação da Fase 4 cobre abrindo conversas reais.
6. **Reversão necessária.** Mitigação: linha Z-API mantida inativa (não deletada) + CSV de backup → rollback = UPDATE inverso `0833dc6c… → 72e1beb5…` e reativar Z-API.
7. **Mensagens novas chegando durante a janela de migração.** Mitigação: executar a migração logo após conectar uazapi e derrubar Z-API; o UPDATE por `whatsapp_number_id` antigo não conflita com as novas (já gravadas com o id uazapi).

---

## Detalhes técnicos
- Origem: `whatsapp_number_id = 72e1beb5-8b35-4158-8ae0-3e9efa306de0` (zapi).
- Destino: `whatsapp_number_id = 0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c` (uazapi, owner `r5cabd36dc18935`).
- Migração via tool de migration (UPDATE em transação) — sem alteração de schema.
- Backup CSV via `COPY (...) TO STDOUT` para `/mnt/documents/`.
- Nenhuma mudança em lógica de negócio do webhook é necessária: a resolução por `owner` já garante o isolamento entre instâncias. O foco é operacional (conectar/derrubar/migrar/validar).

---

## Ordem de execução recomendada
1. Backup CSV + contagens (Fase 0).
2. Conectar uazapi Pérola + configurar/validar webhook com 1 mensagem teste (Fase 1).
3. Derrubar e inativar Z-API Pérola (Fase 2).
4. Rodar migração do histórico + bindings (Fase 3).
5. Validar conversas, envio e roteamento (Fase 4).

Posso começar pela Fase 0 (backup) e pelo inventário das colunas `whatsapp_number_id` que apontam para a linha Z-API, já deixando o UPDATE de migração pronto para você aprovar.