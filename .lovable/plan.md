## Objetivo

Permitir que o Estrategista (aba Marketing → Estratégia) consiga:

1. Ler o resultado de uma ou várias campanhas de disparo (quem recebeu, leu, respondeu, comprou depois, falhou).
2. Ler leads que ainda não compraram (`ad_leads`, `event_leads`, `lp_leads`, `link_page_leads`) por período/canal.
3. Criar um público reutilizável a partir dessas listas e salvá-lo em Disparos — mesmo quando o público é uma **lista fixa de telefones**, não um filtro RFM.

Sem quebrar nada: hoje `campanha_publicos.filtro_json` só aceita filtros de `crm_customers_v`. Vamos **estender** o formato aceitando um novo modo `{ mode: "phone_list", phones: [...] }`, mantendo 100% compatível com o modo atual (filtro CRM).

---

## Parte 1 — Novas tools de leitura no agente

Arquivo: `supabase/functions/marketing-agent-chat/index.ts`.

Adicionar 3 tools READ (sem escrita):

### `list_dispatches`
Lista campanhas de disparo do período com métricas agregadas.
- Args: `desde`, `ate`, `query` (opcional, casa em `campaign_name` ou `template_name`).
- Fonte: `dispatch_history` + agregação de `dispatch_recipients` por status.
- Retorna: `id`, `campaign_name`, `template_name`, `started_at`, `total_recipients`, `sent`, `delivered`, `read`, `failed`, `replied` (via join com `whatsapp_messages` por `wamid` quando existir).

### `get_dispatch_result`
Detalhe de uma campanha específica.
- Args: `dispatch_id` **ou** `campaign_name`. Aceita array `dispatch_ids` para combinar várias.
- Retorna: contagem por status + amostra (≤50) de telefones por bucket:
  - `received` (sent/delivered/read)
  - `read`
  - `replied` (cruza `dispatch_recipients.message_wamid` com `whatsapp_messages` do mesmo telefone posterior ao envio, `from_me=false`)
  - `failed` / `not_delivered`
  - `converted` (comprou depois do envio: cruza sufixo 8-díg. com `pos_sales.created_at > sent_at` — respeitando o mesmo padrão de match usado no CRM)
  - `not_converted` (recebeu e leu, mas não comprou no período)

### `get_leads_pool`
Puxa leads não-clientes por período/canal para virarem público.
- Args: `desde`, `ate`, `sources[]` (subset de `ad_leads`, `event_leads`, `lp_leads`, `link_page_leads`), `only_never_purchased` (default true — exclui quem tem venda em `pos_sales`).
- Retorna: contagem + amostra + total de telefones únicos normalizados.

Todas as tools normalizam telefone com o mesmo `extractPhoneKey` do `_shared/dispatch-attribution.ts` (sufixo 8 díg. + DDD).

---

## Parte 2 — Público por lista de telefones (`phone_list`)

Extensão mínima e retrocompatível de `campanha_publicos.filtro_json`.

Formato hoje (mantido):
```json
{ "include": {...}, "exclude": {...} }
```

Novo formato aceito:
```json
{
  "mode": "phone_list",
  "source": "dispatch_result" | "leads_pool" | "manual",
  "source_ref": { "dispatch_ids": [...], "bucket": "not_converted" },
  "phones": ["3399...", ...]   // telefones já normalizados (E.164 sem símbolos)
}
```

### Onde adaptar o consumo
Localizar consumidores de `campanha_publicos.filtro_json` (essencialmente `MassTemplateDispatcher` e RPC `bc_match_audience`):

1. **Frontend Disparos** (`MassTemplateDispatcher.tsx`): ao carregar um público, se `filtro_json.mode === "phone_list"`, pular a chamada de `bc_match_audience` e usar `phones` direto como destinatários (mesma pipeline já usada quando o operador cola telefones manualmente).
2. **Preview/contagem**: exibir `phones.length` como total.
3. **`bc_match_audience`** e demais RPCs: **não** precisam mudar — só serão chamadas para o modo antigo.

Isso garante zero impacto em públicos existentes.

### Nova tool de escrita: `propor_publico_lista`
- Args: `nome`, `descricao_curta`, `source` (`dispatch_result`|`leads_pool`|`manual`), `source_ref` (jsonb livre com o filtro usado), `phones[]`.
- Fluxo idêntico a `propor_publico`: propõe → usuário confirma → grava em `campanha_publicos` com o novo `filtro_json`.
- Validação server-side: dedup de telefones, remove entradas na `identity_blacklist` (sufixo 8 díg.), aplica normalização E.164 BR.

O `propor_publico` atual (filtro RFM) continua igual — só ganha um irmão.

---

## Parte 3 — Instruções no system prompt do agente

Adicionar ao prompt em `marketing-agent-chat/index.ts` (bloco PÚBLICOS):

- Quando o usuário pedir "quem recebeu campanha X mas não comprou":
  1. `list_dispatches` para achar o `dispatch_id`.
  2. `get_dispatch_result` com `bucket: "not_converted"`.
  3. `propor_publico_lista` com os `phones` retornados.
- Quando o usuário pedir "leads frescos de julho que nunca compraram":
  1. `get_leads_pool` com `sources` e `only_never_purchased=true`.
  2. `propor_publico_lista`.
- Sempre citar `source_ref` para rastreabilidade.
- Se a lista tiver > 5.000 telefones, avisar o usuário antes de propor.

---

## Parte 4 — Sem quebra

- Nada muda em `campanha_publicos` schema (é `jsonb`, aceita qualquer shape).
- Sem migration de dados.
- Consumidores antigos (RFM) intactos. Único ajuste real de código no front é um `if (filtro_json.mode === "phone_list") { … }` cedo no fluxo de Disparos.
- Tools novas são READ-ONLY exceto `propor_publico_lista`, que passa pelo mesmo two-step confirm dos demais `propor_*`.

---

## Detalhes técnicos (para a implementação)

Arquivos previstos:
- `supabase/functions/marketing-agent-chat/index.ts` — 3 tools READ + 1 tool WRITE + trechos de prompt + `commitProposal` novo case `propor_publico_lista`.
- `src/components/marketing/MassTemplateDispatcher.tsx` — branch para carregar público modo `phone_list` (bypass do `bc_match_audience`, usa `phones` direto).
- `src/components/pos/audience/AudienceFilterBuilder.tsx` (só leitura defensiva) — mostrar badge "Lista fixa (N telefones)" quando `mode === "phone_list"`, sem tentar renderizar filtros.

RPC opcional (fase 2, se ficar lento no front): `bc_audience_from_phone_list(p_phones text[])` retornando `unified_customer_id` quando existir — puramente para dashboards. Não bloqueia envio.

Conversão (bucket `converted`): cruza `dispatch_recipients.sent_at` com `pos_sales.created_at` por sufixo 8-díg. do telefone, janela `[sent_at, sent_at + 14 dias]`. Configurável via arg opcional `janela_conversao_dias` (default 14).

Custo: nenhuma alteração em tabelas, só leituras + inserts em `campanha_publicos`.