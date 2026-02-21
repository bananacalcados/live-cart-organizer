

## Plano de Correcao: 3 Problemas Criticos

Identifiquei as causas raiz de cada problema apos analise detalhada dos logs, banco de dados e codigo.

---

### Problema 1: Catalogo nao envia produtos (erro no Z-API)

**Causa raiz:** O payload enviado para a Z-API esta no formato errado. O endpoint correto para enviar botoes COM imagem e `send-button-list-image` (nao `send-button-list`). Alem disso, a estrutura do JSON esta incorreta - o sistema envia `buttonList` como array simples, mas a Z-API espera o formato `buttonList: { image: "url", buttons: [...] }`.

**Evidencia nos logs:**
```text
Error sending Z-API button list: SyntaxError: Unexpected end of JSON input
```
A Z-API retorna resposta vazia (nao JSON) porque rejeita o payload malformado.

**Correcao no `supabase/functions/zapi-send-button-list/index.ts`:**
- Trocar endpoint de `send-button-list` para `send-button-list-image`
- Reestruturar payload para o formato correto da Z-API:
```text
{
  "phone": "5533991955003",
  "message": "Escolha como quer comprar:\nTamanco Modare - 34/Oliva",
  "buttonList": {
    "image": "https://cdn.shopify.com/...",
    "buttons": [
      { "id": "delivery_SKU", "label": "R$120 Entrega" },
      { "id": "pickup_SKU", "label": "R$108 Retira Loja" },
      { "id": "store_SKU", "label": "R$132 Loja Fisica" }
    ]
  }
}
```
- Adicionar tratamento seguro para resposta nao-JSON da Z-API (usar `response.text()` e tentar parse, em vez de chamar `.json()` diretamente)

---

### Problema 2: Vendas do PDV nao estao sendo registradas

**Causa raiz:** A funcao `loadNotifications` no dashboard do POS busca TODAS as 72.412 mensagens do WhatsApp sem limite. Como o Supabase tem um limite padrao de 1.000 linhas por query, os dados retornados estao incompletos, resultando em contagens erradas. Alem disso, o Supabase Realtime dispara essa query pesada a CADA nova mensagem recebida, causando sobrecarga que pode travar a aplicacao e impedir que vendas sejam finalizadas.

O erro "The app encountered an error" (visivel no screenshot) provavelmente e causado por essa sobrecarga - a aplicacao trava durante o processo de venda porque o Realtime continua disparando queries massivas em background.

**Evidencia:** 
- 72.412 mensagens no banco, query sem `.limit()` retorna no maximo 1.000
- Nenhuma chamada para `pos-tiny-create-sale` aparece nos logs de hoje (21/02), mas existem 11 vendas registradas ate 20/02
- O Realtime dispara `loadNotifications()` a cada mensagem nova, e com o volume de mensagens da live (dezenas por minuto), isso cria uma tempestade de queries

**Correcao no `src/components/pos/POSSalesView.tsx`:**
- Substituir a query que busca todas as mensagens por uma abordagem eficiente usando RPC ou query otimizada:
  - Usar uma query SQL que agrupa diretamente no banco (via RPC) em vez de processar 72k+ registros no frontend
  - Alternativa: usar `DISTINCT ON (phone)` para pegar apenas a ultima mensagem por telefone
- Adicionar debounce no handler do Realtime (minimo 5 segundos entre recargas) para evitar tempestade de queries durante lives
- Garantir que o Realtime NAO bloqueia o fluxo de vendas

**Criar RPC `get_conversation_counts`:**
Uma funcao SQL que calcula os contadores diretamente no banco, retornando apenas dois numeros (awaiting e new) em vez de transferir milhares de linhas para o frontend.

---

### Problema 3: Bugs recorrentes ao mexer em uma parte do sistema

**Explicacao tecnica:** O problema nao e do GitHub - o Git controla versoes de codigo, mas nao impede que mudancas em um componente afetem outros que compartilham o mesmo estado ou dados. No caso especifico:

- A adicao do Realtime no dashboard criou uma dependencia pesada que afeta todo o POS
- Queries sem limite em tabelas grandes sao uma bomba-relogio que explode quando o volume de dados cresce
- O componente `POSSalesView` acumula muitas responsabilidades (vendas + dashboard + notificacoes), o que aumenta o risco de efeitos colaterais

A correcao dos problemas 1 e 2 acima resolve os bugs atuais. Para prevenir futuros problemas, a query otimizada via RPC e o debounce no Realtime sao fundamentais.

---

### Resumo das Alteracoes

| Arquivo | Acao | Detalhes |
|---------|------|----------|
| `supabase/functions/zapi-send-button-list/index.ts` | CORRIGIR | Endpoint correto + payload Z-API formatado + parse seguro de resposta |
| `src/components/pos/POSSalesView.tsx` | CORRIGIR | Substituir query de 72k+ msgs por RPC otimizada + debounce no Realtime |
| Migracao SQL | CRIAR | Funcao RPC `get_conversation_counts` para calcular contadores no banco |

### Detalhes Tecnicos

**RPC `get_conversation_counts`:**
```text
CREATE OR REPLACE FUNCTION get_conversation_counts()
RETURNS TABLE(awaiting_count bigint, new_count bigint) AS $$
  WITH last_msgs AS (
    SELECT DISTINCT ON (phone)
      phone, direction, created_at
    FROM whatsapp_messages
    ORDER BY phone, created_at DESC
  ),
  has_outgoing AS (
    SELECT DISTINCT phone
    FROM whatsapp_messages
    WHERE direction = 'outgoing'
  ),
  finished AS (
    SELECT DISTINCT ON (phone) phone, finished_at
    FROM chat_finished_conversations
    ORDER BY phone, finished_at DESC
  ),
  active AS (
    SELECT lm.phone, lm.direction,
      CASE WHEN ho.phone IS NOT NULL THEN true ELSE false END as has_reply
    FROM last_msgs lm
    LEFT JOIN has_outgoing ho ON ho.phone = lm.phone
    LEFT JOIN finished f ON f.phone = lm.phone
    WHERE lm.direction = 'incoming'
      AND (f.finished_at IS NULL OR f.finished_at < lm.created_at)
  )
  SELECT
    COUNT(*) FILTER (WHERE has_reply) as awaiting_count,
    COUNT(*) FILTER (WHERE NOT has_reply) as new_count
  FROM active;
$$ LANGUAGE sql SECURITY DEFINER;
```

**Debounce no Realtime:**
```text
// Em vez de chamar loadNotifications() diretamente:
const debounceTimer = useRef<NodeJS.Timeout>();
const debouncedLoad = () => {
  if (debounceTimer.current) clearTimeout(debounceTimer.current);
  debounceTimer.current = setTimeout(loadNotifications, 5000);
};

// No canal Realtime:
.on("postgres_changes", ..., () => debouncedLoad())
```

