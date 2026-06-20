# Por que os nomes não atualizam ao "Sincronizar do WhatsApp"

Investiguei o banco e o código. O sync **funciona**, mas grava os nomes novos em **registros diferentes** dos que a campanha realmente usa. Há dois descasamentos:

## 1. Descasamento de `instance_id`
A tabela `whatsapp_groups` tem uma constraint única em `(group_id, instance_id)`. Os grupos da campanha **GRUPO LIVE** foram salvos antigamente com:

```
instance_id = 3ED1FFCA10B9621BDE0A3A43AB49A453   (token antigo da uazapi)
```

Mas o sync de hoje roda com:

```
instance_id = fb7dd381-6460-4f28-8d01-f15943edb879   (id do número de WhatsApp)
```

## 2. Descasamento de formato do `group_id`
- Registros antigos (os que a campanha usa): `120363427586598950-group`
- Registros do sync novo: `120363427586598950@g.us`

Como **as duas chaves** (`group_id` e `instance_id`) são diferentes, o `upsert onConflict (group_id, instance_id)` **nunca encontra** a linha antiga. Resultado: ele **insere linhas novas** com os nomes atualizados, e as linhas antigas (referenciadas em `group_campaigns.target_groups`) continuam com os nomes velhos. Por isso a tela mostra duplicatas e os nomes antigos.

Confirmei: os 11 grupos da campanha GRUPO LIVE estão todos com `instance_id = 3ED1...` e `group_id` no formato `...-group`, com `last_synced_at` parado em 8-10/jun.

## Por que isso NÃO afeta os disparos
O worker de disparo (`group-dispatch-worker` → `uazapi-groups`) normaliza o JID com `groupJid()`, que **remove tudo que não é dígito** e adiciona `@g.us`. Ou seja, `120363427586598950-group` e `120363427586598950@g.us` viram o **mesmo** JID na hora de enviar. Então atualizar só o nome dos registros antigos é seguro: o número do grupo é idêntico.

---

# Plano de correção (sem quebrar nada nem os disparos)

A ideia central: **atualizar o nome (e foto/contagem) nas linhas que já existem**, casando pelo **número do grupo** (dígitos), em vez de criar linhas paralelas. Sem mexer em `id`, sem apagar nada, sem trocar `instance_id`/`group_id` das linhas referenciadas pela campanha.

## Etapa 1 — Melhorar o sync (`supabase/functions/uazapi-groups`, ação `list`)
Antes de inserir os grupos novos, fazer um passo de **atualização por número**:
1. Para cada grupo retornado da uazapi, extrair só os dígitos do JID (ex.: `120363427586598950`).
2. Buscar em `whatsapp_groups` todas as linhas cujo `group_id` contenha esses mesmos dígitos (independente de sufixo `-group`/`@g.us` e de `instance_id`).
3. `UPDATE` apenas dos campos de exibição nessas linhas: `name`, `photo_url`, `participant_count`, `previous_participant_count`, `last_synced_at`. **Não** alterar `id`, `group_id` nem `instance_id`.
4. Manter o `upsert` atual depois disso, para que grupos realmente novos continuem sendo cadastrados.

Assim os 11 grupos da campanha (linhas antigas) passam a receber o nome novo a cada sync, e os disparos continuam idênticos.

## Etapa 2 — Paridade (opcional, mesma lógica)
Aplicar o mesmo passo de "atualizar por dígitos" em `wasender-groups` e `zapi-list-groups` para evitar o mesmo problema em campanhas dessas instâncias no futuro.

## Etapa 3 — Limpeza visual das duplicatas (opcional, separada e segura)
A lista hoje mostra o grupo duplicado (linha antiga + linha nova do sync). Para limpar **sem risco**:
- Na consulta da lista do front (`fetchAllGroups`), agrupar/deduplicar por dígitos do `group_id`, **priorizando** a linha que estiver referenciada em alguma campanha (preserva o `id` usado nos disparos).
- Nenhuma linha é apagada do banco — apenas a exibição é deduplicada. Pode ficar para um segundo momento.

## Validação
1. Rodar o sync na campanha GRUPO LIVE (uazapi) e confirmar que os 11 grupos passam a exibir os nomes novos.
2. Conferir no banco que os `id` dos `target_groups` continuam os mesmos (campanha intacta).
3. Disparo de teste em 1 grupo para confirmar entrega (JID normalizado idêntico).

## Arquivos afetados
- `supabase/functions/uazapi-groups/index.ts` (núcleo da correção)
- `supabase/functions/wasender-groups/index.ts`, `supabase/functions/zapi-list-groups/index.ts` (paridade, opcional)
- `src/components/marketing/CampaignDetailPanel.tsx` (dedup visual, opcional)
- **Sem migração de banco e sem alteração de dados destrutiva.**
