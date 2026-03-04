

# Correção do Envio de Enquetes nos Grupos VIP

## Diagnóstico

Os logs da Edge Function `zapi-send-group-message` mostram erro claro:

```
Error sending group message: SyntaxError: Unexpected end of JSON input
```

Isso acontece porque a Z-API retorna resposta vazia/não-JSON quando recebe o payload da enquete no formato errado.

**Formato atual (ERRADO):**
```json
{
  "phone": "grupo@g.us",
  "poll": {
    "name": "Pergunta",
    "options": ["Opção 1", "Opção 2"],
    "selectableOptionsCount": 1
  }
}
```

**Formato correto da Z-API:**
```json
{
  "phone": "grupo@g.us",
  "message": "Pergunta",
  "pollMaxOptions": 1,
  "poll": [
    {"name": "Opção 1"},
    {"name": "Opção 2"}
  ]
}
```

A documentação oficial (developer.z-api.io/en/message/send-poll) confirma que `poll` deve ser um array de objetos `{name: string}`, não um objeto aninhado.

## Correções

### 1. `supabase/functions/zapi-send-group-message/index.ts`

- Corrigir o bloco `type === 'poll'` para montar o body no formato correto da Z-API:
  - `message` = texto da enquete
  - `poll` = array de `{name: string}`
  - `pollMaxOptions` = 1
- Adicionar tratamento seguro para `res.json()` — usar `res.text()` primeiro e depois tentar `JSON.parse`, para evitar crash quando a Z-API retorna resposta vazia

### 2. Tratamento de resposta vazia

Envolver o `res.json()` em try/catch com fallback para `res.text()` para que erros de parse não causem crash silencioso (o catch atual não loga o payload da Z-API).

---

Nenhuma alteração no frontend é necessária. A enquete já está sendo criada e enviada corretamente pelo `CampaignDetailPanel` e `ScheduledMessageForm`. O problema é exclusivamente no formato do payload enviado à Z-API.

