
# Melhorias no Typebot: Perguntas Estruturadas + Condições de Avanço

Duas melhorias no criador de Typebot (Marketing → Eventos → Captação) que não alteram fluxos existentes — todos os steps atuais (`ask_name`, `ask_phone`, `message`, `final`) continuam funcionando exatamente como hoje.

## 1. Novos tipos de pergunta (com respostas padronizadas)

Adicionar 2 novos tipos de step no builder:

- **`ask_choice`** — pergunta de escolha única (radio / botões). Ex.: "Você compra online?" → Sim / Não.
- **`ask_multichoice`** — múltipla escolha (checkboxes). Ex.: "Quais tamanhos você usa?" → 34, 35, 36...

Cada pergunta desse tipo grava a resposta em um **campo customizado** identificado por uma `field_key` (ex.: `tamanho_calcado`, `cidade`, `compra_online`). O admin escolhe a key ao criar a pergunta ou seleciona uma existente de uma lista de sugestões (tamanho, numeração, cor preferida, cidade, faixa etária…).

### Onde as respostas ficam salvas

Uma única coluna nova `event_leads.custom_fields JSONB` (default `'{}'`). Exemplo de conteúdo:
```json
{ "tamanho_calcado": "36", "cidade": "Valadares", "compra_online": "sim" }
```
Index GIN em `custom_fields` para permitir filtros rápidos.

Nada é adicionado às colunas fixas atuais — leads antigos ficam com `{}` e continuam válidos.

### Filtro para disparos

Na tela de **Disparos → Público** (audience builder) adicionar um novo filtro **"Campo personalizado do Typebot"**:
- Selecionar `field_key` (lista deduplicada a partir dos typebots existentes).
- Operador `=`, `≠`, `contém`, `um de [lista]`.
- Ex.: leads com `tamanho_calcado ∈ {35, 36, 37}` → dispara campanha específica.

O agente IA de marketing (`propor_publico_lista`) também ganha acesso via nova ferramenta `filter_leads_by_custom_field`.

## 2. Condições de avanço / disqualificação

Cada pergunta do tipo `ask_choice` ganha campo opcional **"Condição para continuar"**:
- **Continuar se resposta ∈ [opções permitidas]** → segue o fluxo normal.
- **Caso contrário** → executa uma ação configurável:
  - `end_flow`: encerra com mensagem custom (ex.: "Obrigada! Essa promoção é só para Valadares 😊") e **NÃO grava lead** (ou grava com flag `disqualified=true`, à escolha do admin — default: não grava).
  - `skip_to_step`: pula para um step específico.

Ex.: "Você mora em Valadares?" → Não → encerra sem salvar lead → economiza SMS/WhatsApp/estoque de leads inúteis.

Nova coluna `event_leads.disqualified BOOLEAN DEFAULT false` (só usada quando admin optar por gravar mesmo assim, para análise).

## Interface do Builder

Na tela `EventCaptureBuilder`, ao adicionar step:
- Dropdown de tipo ganha 2 opções novas: **"Escolha única"** e **"Múltipla escolha"**.
- Painel de edição da pergunta mostra:
  - Texto da pergunta
  - `field_key` (input com autocomplete das keys já usadas)
  - Lista editável de opções (label + value)
  - Toggle "Obrigatória"
  - Seção **"Condição"** (só em escolha única): escolher opções válidas + ação se inválido + mensagem final.

## Frontend público (`EventTypebotView`)

- Renderiza botões/checkboxes ao invés do input de texto quando `step.type ∈ ('ask_choice','ask_multichoice')`.
- Guarda as respostas em `collected.custom_fields`.
- Avalia condição antes de avançar; se disqualificado, exibe a mensagem final e para (não chama `event-lead-capture`, ou chama com flag `disqualified`).

## Backend (`event-lead-capture`)

- Aceita novos campos: `custom_fields` (obj) e `disqualified` (bool).
- Grava em `event_leads.custom_fields` e `event_leads.disqualified`.
- Se `disqualified=true` e admin configurou "não gravar", retorna sucesso sem inserir.
- Zero mudança para chamadas antigas (parâmetros são opcionais).

## Detalhes técnicos

**Migration (única, aditiva):**
```sql
ALTER TABLE public.event_leads
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS disqualified BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_event_leads_custom_fields
  ON public.event_leads USING GIN (custom_fields);
```

**Shape do step novo em `flow_json.steps`:**
```ts
{
  id: string,
  type: 'ask_choice' | 'ask_multichoice',
  text: string,
  field_key: string,           // ex.: 'tamanho_calcado'
  options: { label: string, value: string }[],
  required?: boolean,
  condition?: {                // só ask_choice
    allowed_values: string[],
    on_fail: 'end_flow' | 'skip_to_step',
    fail_message?: string,
    skip_to_step_id?: string,
    save_lead_when_disqualified?: boolean, // default false
  }
}
```

**Arquivos tocados:**
- `supabase/migrations/*` — migration acima.
- `src/pages/events/EventCaptureBuilder.tsx` — novo editor de step + condição.
- `src/pages/public/EventTypebotView.tsx` — render de choice/multichoice + avaliação de condição.
- `supabase/functions/event-lead-capture/index.ts` — persistência de `custom_fields`/`disqualified`.
- Audience builder de disparos (arquivo em `src/components/marketing/…`) — novo filtro "Campo personalizado".
- Agente IA marketing (`marketing-agent-chat` edge function) — tool `filter_leads_by_custom_field`.

## Compatibilidade / risco

- Tudo aditivo: colunas novas com default, tipos de step novos ignorados pelo código antigo (se algum caiu).
- Nenhum step existente é alterado.
- Leads antigos continuam válidos (`custom_fields = {}`, `disqualified = false`).
- Se o admin não usar os novos tipos, o typebot funciona idêntico ao de hoje.

Posso seguir com essa implementação?
