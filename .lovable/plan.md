

## Plano Atualizado: Botoes Interativos em AMBOS os canais (Z-API + Meta Cloud API)

O plano anterior ja previa suporte a ambos, mas vou detalhar exatamente como funcionara em cada canal.

---

### Como funciona em cada canal

**Z-API:** Endpoint `send-button-list` para enviar mensagens com botoes clicaveis.

**Meta Cloud API:** Dentro da janela de 24h, a API permite enviar mensagens do tipo `interactive` com ate 3 reply buttons SEM precisar de template aprovado. O payload e assim:

```text
{
  "messaging_product": "whatsapp",
  "to": "5533999998803",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": { "type": "image", "image": { "link": "URL_DA_FOTO" } },
    "body": { "text": "Tenis Nice\nDe R$ 319,99 por R$ 299,99" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "btn_delivery", "title": "R$ 299 c/ Entrega" } },
        { "type": "reply", "reply": { "id": "btn_pickup", "title": "R$ 269 Retira Loja" } },
        { "type": "reply", "reply": { "id": "btn_store", "title": "R$ 319 Loja Fisica" } }
      ]
    }
  }
}
```

Isso e uma mensagem de sessao normal (nao template), entao funciona perfeitamente dentro das 24h.

---

### Alteracoes Tecnicas

**1. Edge Function `meta-whatsapp-send` (MODIFICAR)**

Adicionar suporte ao tipo `interactive` no switch de tipos de mensagem. O componente do frontend enviara:

```text
{
  phone: "33999998803",
  type: "interactive",
  interactiveData: {
    header: { type: "image", imageUrl: "https://..." },
    body: "Tenis Nice\nDe R$ 319,99 por R$ 299,99",
    buttons: [
      { id: "btn_delivery", title: "R$ 299 c/ Entrega" },
      { id: "btn_pickup", title: "R$ 269 Retira Loja" },
      { id: "btn_store", title: "R$ 319 Loja Fisica" }
    ]
  },
  whatsappNumberId: "uuid-do-numero"
}
```

A function montara o payload `interactive` com header de imagem + body de texto + ate 3 reply buttons.

**2. Edge Function `zapi-send-button-list` (CRIAR)**

Nova function para Z-API usando o endpoint `send-button-list` com estrutura equivalente: imagem + texto + botoes clicaveis.

**3. Componente `POSProductCatalogSender` (CRIAR)**

O componente detectara automaticamente qual canal esta ativo na conversa (Z-API ou Meta) e chamara a function correta:
- Se `whatsapp_number_id` presente -> Meta Cloud API (`meta-whatsapp-send` com type `interactive`)
- Se Z-API -> `zapi-send-button-list`

**4. Limite de 3 botoes da Meta**

A Meta permite no maximo 3 reply buttons por mensagem. Como temos exatamente 3 opcoes de preco (Entrega, Retirada, Loja Fisica), encaixa perfeitamente. O titulo de cada botao tem limite de 20 caracteres, entao os textos serao abreviados (ex: "R$ 269 Retira Loja").

---

### Resumo dos arquivos

| Arquivo | Acao |
|---------|------|
| `supabase/functions/meta-whatsapp-send/index.ts` | MODIFICAR - Adicionar tipo `interactive` com reply buttons |
| `supabase/functions/zapi-send-button-list/index.ts` | CRIAR - Envio de botoes via Z-API |
| `src/components/pos/POSProductCatalogSender.tsx` | CRIAR - Seletor de produtos com envio dual-channel |
| `src/components/pos/POSWhatsApp.tsx` | MODIFICAR - Integrar botao de catalogo |
| `src/components/pos/POSSalesView.tsx` | MODIFICAR - Dashboard clicavel |
| `src/components/pos/POSConfig.tsx` | MODIFICAR - Precificacao por modalidade |
| `src/pages/POS.tsx` | MODIFICAR - Navegacao com filtro |
| Migracao SQL | CRIAR - Tabela `pos_product_pricing_rules` |

### Fluxo unificado

```text
Vendedor abre conversa -> Clica "Catalogo" -> Seleciona produtos -> Clica "Enviar"
                                                                         |
                                              +---------------------------+---------------------------+
                                              |                                                       |
                                     Conversa Meta API                                       Conversa Z-API
                                              |                                                       |
                                   meta-whatsapp-send                                    zapi-send-button-list
                                   type: "interactive"                                   endpoint: send-button-list
                                   header: image                                         image + buttons
                                   body: nome + preco                                    texto + preco
                                   buttons: 3 reply                                      buttons: 3 opcoes
                                              |                                                       |
                                              +---------------------------+---------------------------+
                                                                          |
                                                              Cliente recebe foto
                                                           com 3 botoes de preco
                                                          e clica na opcao desejada
```

