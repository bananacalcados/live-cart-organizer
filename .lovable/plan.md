# Disparo via Meta WhatsApp API com Template no Módulo Eventos

## Objetivo
Quando o canal do evento for **Meta WhatsApp API (Cloud)**, o sistema dispara para cada pedido novo um **template aprovado** (não mais texto livre), com variáveis preenchidas dinamicamente a partir do pedido (link de pagamento, nome, @ Instagram, produtos etc.).

---

## 1. Banco — novas colunas em `events`

| Coluna | Tipo | Uso |
|---|---|---|
| `meta_template_name` | text | nome do template aprovado na Meta |
| `meta_template_language` | text (default `pt_BR`) | idioma do template |
| `meta_template_body_variables` | jsonb (`[]`) | array ordenado de **tokens** para `{{1}}, {{2}}, ...` do corpo |
| `meta_template_header_variable` | text | token opcional para header com mídia/texto |

Nada destruidor — só adição de colunas.

---

## 2. Tokens disponíveis (resolvidos por pedido)

| Token | Valor |
|---|---|
| `{customer_name}` | nome completo |
| `{customer_first_name}` | primeiro nome |
| `{instagram}` | @ do cliente |
| `{products}` | lista formatada multi-linha |
| `{products_short}` | títulos separados por vírgula |
| `{checkout_link}` | URL do checkout do pedido |
| `{subtotal}` / `{discount}` / `{total}` | valores R$ |
| `{order_id}` | ID curto do pedido |

---

## 3. UI — `src/pages/Events.tsx`

No modal de Novo/Editar Evento, quando:
- `channel_preference === 'meta_whatsapp'` **E** `whatsapp_number_id` selecionado

Aparece um novo bloco **"Template Meta para Automação"**:

1. **Select "Template"** — carrega via `meta-whatsapp-get-templates` filtrado por `status=APPROVED` daquela instância.
2. Ao selecionar, mostra preview do corpo com `{{1}}, {{2}}` destacados.
3. Para cada variável detectada (body + header), renderiza um **Select de Token** (com os tokens da seção 2) — é isso que define o mapeamento.
4. Painel "Pré-visualização" mostra o template com valores fake.

Tudo é salvo em `events` no submit.

---

## 4. Edge Function nova: `meta-template-send`

Envia template via Graph API:

```ts
POST /{phone_number_id}/messages
{
  messaging_product: "whatsapp",
  to: phone,
  type: "template",
  template: {
    name: templateName,
    language: { code: language },
    components: [
      { type: "header", parameters: [...] },  // se aplicável
      { type: "body", parameters: [...] }
    ]
  }
}
```

Usa as credenciais da `whatsapp_numbers` (mesmo padrão de `meta-whatsapp-send`) e loga em `whatsapp_messages`.

---

## 5. `livete-start-order` — branch novo

Lógica de roteamento passa a ser:

```
if channel_preference === 'instagram'      → instagram-dm-send (já existe)
if channel_preference === 'meta_whatsapp'
   AND event.meta_template_name presente   → meta-template-send (NOVO, com tokens resolvidos)
else                                       → 3 blocos de texto Z-API/Meta (comportamento atual)
```

Resolução de tokens é uma função pura `renderToken(token, order, customer)` chamada por slot.

A sessão de IA (`automation_ai_sessions`) e o `update_order_stage` continuam iguais — só muda **o método de entrega da primeira mensagem**.

---

## Fora do escopo
- Renovação do token Instagram (issue separada, já diagnosticada).
- Suporte a botões de template (quick reply / URL dinâmica) — adicionável depois sem mexer no schema.
- Templates com mídia de header com URL dinâmica — schema já comporta via `meta_template_header_variable`, mas UI nesse primeiro corte só permite token de texto. Mídia fica numa v2.

---

## Ordem de execução
1. Migração das 4 colunas em `events`.
2. Função `meta-template-send`.
3. UI no modal de evento (seletor + mapeador + preview).
4. Branch no `livete-start-order`.
5. Teste end-to-end com um pedido real.
