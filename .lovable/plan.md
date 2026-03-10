

# Auto-Roteamento de Respostas pela Instância de Origem

## Problema

Quando um cliente manda mensagem pelo **Datacrazy** (instância Z-API), o sistema permite responder pelo **Whats Centro** (outra instância Z-API), causando confusão e erros (ex: erro de 24h da Meta quando a resposta sai por uma instância errada).

**Causa raiz**: A detecção de instância está errada. Na linha 321 do `POSWhatsApp.tsx`:
```typescript
const lastIncomingInstance = lastIncoming?.whatsapp_number_id ? "meta" : "zapi";
```
Isso assume que se tem `whatsapp_number_id`, é Meta — mas instâncias Z-API também gravam esse campo. O sistema não distingue corretamente qual instância específica recebeu a mensagem.

## Solução

Implementar **auto-roteamento**: ao selecionar uma conversa, o sistema detecta automaticamente a instância da última mensagem recebida e trava o envio nela. O operador não precisa (nem consegue) escolher outra instância manualmente para aquela conversa.

### Mudanças

**1. `src/components/pos/POSWhatsApp.tsx`**

- **Corrigir detecção de provider**: Em vez de assumir que `whatsapp_number_id` = Meta, cruzar o ID com a lista `storeNumbers` para verificar o `provider` real.
- **Auto-selecionar instância ao abrir conversa**: No `handleSelectConversation`, buscar a última mensagem incoming, pegar seu `whatsapp_number_id`, encontrar o provider correspondente e setar `sendVia` + `selectedNumberId` automaticamente.
- **Travar seletor de instância**: Quando a conversa tem uma instância de origem definida, desabilitar os botões "Z-API" / "Meta API" e o seletor de número, mostrando apenas a instância ativa com um indicador visual (ex: badge "Auto: Datacrazy").
- **Gravar `whatsapp_number_id` nas mensagens incoming do webhook Z-API** (já existe via `?number_id=UUID`), garantir que o campo é populado.

**2. `src/pages/Chat.tsx`** (módulo Marketing/Chat)

- Aplicar a mesma lógica: ao selecionar conversa, auto-detectar a instância de origem e setar `numberFilter` para o ID correto.

**3. Lógica de detecção (ambos os módulos)**

```text
conversa selecionada
  └─ buscar última mensagem incoming com whatsapp_number_id
       └─ cruzar com storeNumbers/numbers para achar provider
            ├─ provider = 'zapi' → setSendVia('zapi'), setSelectedNumberId(id)
            ├─ provider = 'meta' → setSendVia('meta'), setSelectedNumberId(id)
            └─ sem whatsapp_number_id → fallback para primeira instância Z-API da loja
```

**4. UI: Indicador de instância travada**

Substituir os botões manuais "Z-API" / "Meta API" por um badge informativo quando a instância estiver auto-detectada:
```
[🔒 Datacrazy]  Whats Cent... +5533991229191
```
O operador verá claramente por qual número está respondendo, sem poder trocar acidentalmente.

