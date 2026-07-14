# Matriz de Temperatura de Leads + Tags de Comportamento

## O que os dados reais mostram (base atual)

- **100.268** contatos em `customers_unified` → **60.718 compradores** e **39.550 nunca compraram** (leads puros).
- Só **2.475** têm alguma tag hoje → **97.793 sem nenhuma classificação**. É aqui que está a cegueira.
- Sinais de engajamento que já temos por telefone (DDD+8):
  - **Leitura de disparo** (`dispatch_recipients.status='read'`): 24.927 telefones distintos já leram algum disparo.
  - **Resposta ativa** (`whatsapp_messages` incoming, 90d): **10.832** telefones responderam — o sinal mais forte.
  - **Reativos de ouro**: **7.737 não-compradores leram um disparo nos últimos 60 dias** — este é o segmento que você pediu para isolar.
- Já existe o conceito de temperatura em `ad_leads` (frio/morno/quente/super_quente), mas só no funil de anúncios. Vamos generalizar para toda a base.

## Princípio da matriz

Temperatura mede **intenção/engajamento recente**, não valor histórico (isso é o RFM, que já existe para compradores). Cruzamos 3 eixos:

```
ENGAJAMENTO   →  respondeu > leu > só recebeu > nunca entregou
RECÊNCIA      →  quão recente foi o último sinal
STATUS        →  já comprou? (comprador vs lead puro)
```

### Escala de temperatura (aplicada a TODOS os contatos)

| Temperatura | Regra (sinal mais recente por DDD+8) | Nº aprox. |
|---|---|---|
| 🔥🔥 **Muito Quente** | Respondeu no WhatsApp ≤15d **ou** entrou em funil de lead ≤7d | alto valor |
| 🔥 **Quente** | Respondeu 16–45d **ou** leu disparo ≤30d **ou** funil 8–30d | ~7.7k reativos entram aqui |
| 🌡️ **Morno** | Leu disparo 31–90d **ou** respondeu 46–90d | recuperável |
| ❄️ **Frio** | Recebe disparos (delivered/sent) mas nunca leu/respondeu | maior fatia |
| 💀 **Inerte** | 3+ disparos, 0 leitura/resposta, **ou** bloqueou/falhou repetido | suprimir da API |

### Tags de comportamento (ortogonais à temperatura)

Aplicadas junto no array `tags` de `customers_unified`, com prefixos para filtrar fácil no construtor de públicos:

- **Origem:** `origem:organico`, `origem:ads`, `origem:live_vip`, `origem:indicacao`, `origem:site`
- **Ciclo:** `lead:novo`, `lead:reativo`, `cliente:ativo`, `cliente:em_risco`, `cliente:perdido`, `convertido:ex_lead`
- **Engajamento:** `engaja:responde`, `engaja:le`, `engaja:ignora`, `bloqueou`
- **Interesse** (quando houver, de `ad_leads`): `interesse:ortopedico`, `tamanho:37`, etc.

## Como isso vira decisão de comunicação (o payoff)

| Temperatura | Política de WhatsApp |
|---|---|
| 🔥🔥 Muito Quente | Atendimento humano / convite VIP para live / oferta direta |
| 🔥 Quente | Grupo VIP de live + cashback com validade curta (urgência) |
| 🌡️ Morno | Nurture leve: conteúdo/prova social, máx. 1 disparo/semana |
| ❄️ Frio | 1 última tentativa com oferta forte; se não reagir → vira Inerte |
| 💀 Inerte | **NÃO disparar via API** (protege reputação do número); reengajar só por ads/orgânico |

Isso responde diretamente à sua dúvida anterior: o público que "já recebeu disparo e não converteu" não é um bloco só — a maioria é Frio/Inerte (parar de gastar API), mas os 7.7k reativos são Quentes e merecem energia.

## Implementação técnica

1. **Migração** — adicionar em `customers_unified`:
   - `lead_temperature text` (frio/morno/quente/muito_quente/inerte)
   - `temperature_updated_at timestamptz`
   - `last_engagement_at timestamptz` (última leitura ou resposta)
   - `last_engagement_type text` (replied/read/delivered/none)
   - `dispatch_ignored_count int` (disparos sem reação seguidos)
   - Índice em `lead_temperature` para o construtor de públicos.

2. **Função de recálculo** `recalculate-lead-temperature` (edge function + cron diário):
   - Agrega `whatsapp_messages` (incoming) e `dispatch_recipients` por sufixo **DDD+8** (mesma lógica já corrigida no webhook).
   - Calcula temperatura + `last_engagement_*` e faz `UPDATE` em lote em `customers_unified`.
   - Refaz as tags de ciclo/engajamento sem apagar tags manuais (VIP, etc.) — merge, não overwrite.

3. **Construtor de Públicos (PDV/Marketing)** — adicionar filtro por `lead_temperature` e por tags de comportamento, para você montar disparos direcionados.

4. **Visão no CRM** — badge de temperatura + tags no card do cliente, e um contador de reativos no dashboard.

## Decisões que preciso confirmar antes de codar

1. **Janelas de tempo** (15/30/45/90 dias) — mantenho os cortes propostos ou você prefere outros?
2. **Regra de "Inerte"** — corto em 3 disparos ignorados seguidos ou prefere 4–5 antes de suprimir?
3. **Escopo inicial** — aplico a matriz à base inteira (compradores + leads) ou só aos 39.550 leads puros primeiro?
4. **Cron** — recálculo diário de madrugada te atende?

Confirmando esses 4 pontos, implemento migração + função de recálculo + filtros de público na sequência.
