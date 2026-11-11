# Grupos VIP — Fase 1: aprovar a mesma mensagem em várias campanhas

## O que você vai ver
1. Em uma campanha, você seleciona os rascunhos e clica em **Aprovar** (igual a hoje).
2. No resumo "Aprovar rascunhos", cada mensagem que também existe em outras campanhas mostra:
   "Esta mensagem também está em:" e, embaixo, uma linha por cópia: **[x] Vips Gv — 11/11 10:05**, **[x] Vips Gv #2 — 11/11 10:10**.
   Todas já vêm marcadas. Dá para desmarcar cada uma.
3. As cópias que não podem ser aprovadas aparecem com um X vermelho e o motivo (por exemplo "Sem mídia" ou "Campanha sem instância"). Elas não têm caixa.
4. O aviso de horário no passado vale também para as cópias. A caixa "Entendi" precisa estar marcada para incluir essas mensagens.
5. Ao clicar em **Aprovar (N)**, o aviso final mostra o resultado por campanha. Exemplo: "Live - Meio de Semana: 3 aprovadas · Vips Gv: 3 aprovadas · Vips Gv #2: 2 aprovadas, 1 bloqueada (sem mídia)".
6. Nada é aprovado sem esse clique. Os horários de cada campanha não mudam.

## Situação hoje (conferida no banco)
- A tabela tem 3.804 mensagens, das quais 43 são rascunhos (42 com lote e 1 sem lote).
- Nenhum rascunho com lote está sem texto.
- No backfill, 31 rascunhos seriam vinculados, formando 7 grupos de cópias entre campanhas diferentes. Nenhuma assinatura se repete dentro da mesma campanha, ou seja, hoje não há ambiguidade.
- O número exato será recontado no momento da migração. Se a contagem por mensagem agrupada der diferente, eu aviso antes de aplicar.

## Regras de vínculo (sync_key)
- A chave é por bloco: `sync_key = <chave da mensagem>:<posição do bloco>`. Todas as cópias do mesmo bloco têm a mesma chave. A chave não depende do texto, então editar uma cópia não quebra o vínculo.
- **Backfill** (só rascunhos com lote; linhas pending, grouped, sent etc. não são tocadas):
  - A assinatura da mensagem inteira junta o lote e a lista ordenada dos blocos (tipo + texto normalizado). A normalização é a mesma de `normalizeMessageText`: espaços colapsados, trim e minúsculas.
  - Só vincula quando a mensagem tem pelo menos um bloco com texto. Mensagem sem texto nenhum fica sem chave, como no espelhamento de mídia.
  - Só vincula quando a mesma assinatura aparece em **2 ou mais campanhas diferentes** e **no máximo uma vez por campanha**. Se aparecer duas vezes na mesma campanha, fica ambígua e não recebe chave.
  - Blocos de imagem sem legenda dentro de uma mensagem agrupada entram pela posição. Eles só são vinculados porque a mensagem como um todo casou (mesmo lote, mesma quantidade de blocos e mesmos tipos na mesma ordem).
  - Proteção contra falso positivo: o mesmo texto em lotes diferentes não casa, o mesmo texto em outra posição ou com outro tipo não casa, e mensagens agrupadas com um número diferente de blocos não casam.
- **Cópia editada depois do vínculo:** continua vinculada, porque editar o texto não quebra a chave. No resumo, quando o texto ou a mídia da cópia estiver diferente da que você está aprovando, aparece o selo **"conteúdo diferente"**. Essa cópia vem **desmarcada** por padrão, e você marca se quiser. Decisão: a cópia nunca é aprovada no escuro com um conteúdo que você não está vendo, e o vínculo também não se perde.
- Rascunho criado dentro do sistema, numa campanha só: fica sem chave e funciona exatamente como hoje.

## Casos de borda
- **Cópia já aprovada, enviada ou cancelada:** nem aparece como irmã (a busca é só por `status='draft'`). A função confere de novo `status='draft'` com trava de linha, e a resposta é `not_draft`.
- **Cópia sem mídia, enquete com menos de 2 opções, contato sem telefone, sem horário, {{link_atendimento}} sem modo:** bloqueada com o motivo. As outras seguem.
- **Campanha sem instância:** a cópia é bloqueada com `missing_instance`. Cada cópia usa a instância da própria campanha e nunca a da âncora.
- **Campanhas com instâncias diferentes:** isso é permitido. Nada de instância é copiado ou alterado.
- **Horário no passado:** listado por cópia. Exige a mesma caixa "Entendi", e a cópia sem o "Entendi" não é enviada.
- **Mensagem agrupada:** as irmãs são buscadas pela chave do bloco 0. Na aprovação, cada cópia faz a própria transição: o bloco 0 vira pending e os outros blocos viram grouped, pelo `message_group_id` da cópia.
- **Âncora bloqueada:** as cópias dela não são aprovadas. Elas só seguem a âncora.
- **Duas aprovações ao mesmo tempo:** a trava de linha e o `WHERE status='draft'` garantem que cada cópia seja aprovada uma vez só.

## Consultas da tela
- **Ao abrir a campanha:** nada muda. A coluna `sync_key` entra na seleção que já existe, que hoje já lista as colunas.
- **Ao abrir o resumo "Aprovar":** 1 chamada, a RPC `group_draft_sync_siblings(p_ids)`. Ela devolve as irmãs com campanha, horário, motivo de bloqueio pré-calculado e o indicador "conteúdo diferente", limitada a 200 linhas. A chamada não se repete e não há polling.
- **Ao aprovar:** 1 chamada, a RPC `approve_group_drafts_synced`. Depois vem a recarga de mensagens que já acontece hoje.
- Não há trigger novo e não há consulta dentro de laço. O índice parcial novo atende a busca das irmãs.

## Fase 2 e Fase 3 (deixar preparado)
- **Fase 2 (aba central):** reaproveita as duas RPCs sem mudança. Basta listar os rascunhos agrupados por `sync_key`, com uma RPC paginada nova nessa fase.
- **Fase 3 (Claude):** ao criar o mesmo rascunho em N campanhas, o Claude gera **um UUID por mensagem** e grava `sync_key = '<uuid>:<block_order>'` em cada bloco de cada campanha, no mesmo insert em que hoje grava o `draft_batch`. Assim o casamento por texto deixa de ser necessário. Vou documentar isso na skill e no `AGENTS.md` de marketing.

## Riscos e como reverter
- **Risco: vínculo errado no backfill.** As regras acima são restritivas, e a aprovação das cópias sempre pede confirmação visual. Para reverter: `UPDATE ... SET sync_key = NULL WHERE status='draft'`.
- **Risco: a tela nova falhar.** A RPC antiga `approve_group_drafts` fica intacta, e há um interruptor no front (sem as irmãs) que volta ao comportamento atual.
- **Reverter a fase inteira:** remover as 2 funções novas e voltar o diálogo. A coluna pode ficar, porque é nullable e ninguém mais a lê.
- O worker de disparo, os intervalos, a velocidade de envio e o `scheduled_at` não são tocados em nenhum ponto.

## Testes
- Teste unitário da assinatura (`src/test/groupDraftSync.test.ts`): texto igual em campanhas diferentes casa; texto igual em lotes diferentes não casa; sem texto não casa; posição ou tipo diferente não casa; duplicado na mesma campanha não casa; número diferente de blocos não casa.
- No banco, com uma transação revertida (rollback), sem aprovar de verdade:
  - âncora + 2 cópias: todas aprovadas, o bloco 0 vira pending, os outros viram grouped e o `scheduled_at` continua idêntico;
  - cópia sem mídia: só ela fica bloqueada;
  - campanha sem instância: só a cópia dela fica bloqueada;
  - cópia já em pending: `not_draft`, e a cópia não é tocada;
  - cópia desmarcada: continua draft.
- Conferência da contagem real do backfill antes e depois.
- Na tela, com a sessão da equipe: abrir o resumo e ver as campanhas e os horários, desmarcar uma, ver o selo "conteúdo diferente" e o aviso de passado. A aprovação real só com a sua autorização.

## Perguntas em aberto
1. A cópia com "conteúdo diferente" deve vir desmarcada (minha proposta) ou ficar bloqueada de vez?
2. As irmãs devem casar só pelo lote igual (proposta) ou também entre lotes diferentes?

## Detalhes técnicos

Arquivos:
- migração nova (via ferramenta de migração);
- `src/components/marketing/CampaignDetailPanel.tsx`: seleção da `sync_key`, diálogo com as irmãs e chamada da RPC nova;
- `src/lib/marketing/groupDraftSync.ts` (novo, reutiliza `normalizeMessageText`);
- `src/test/groupDraftSync.test.ts`;
- `src/integrations/supabase/types.ts` (gerado automaticamente);
- `AGENTS.md` de marketing (regra da `sync_key`).

SQL proposto (não executado):
```sql
ALTER TABLE public.group_campaign_scheduled_messages ADD COLUMN sync_key text;
CREATE INDEX idx_gcsm_sync_key_draft ON public.group_campaign_scheduled_messages (sync_key)
  WHERE sync_key IS NOT NULL AND status = 'draft';

-- backfill: assinatura por mensagem (grupo ou linha solta), só drafts com lote
WITH msg AS (
  SELECT COALESCE(message_group_id, id) mk, campaign_id, draft_batch,
         string_agg(message_type||'::'||lower(btrim(regexp_replace(coalesce(message_content,''),'\s+',' ','g'))),
                    '||' ORDER BY coalesce(block_order,0)) sig,
         bool_or(btrim(coalesce(message_content,''))<>'') has_text
  FROM public.group_campaign_scheduled_messages
  WHERE status='draft' AND draft_batch IS NOT NULL
  GROUP BY 1,2,3),
ok AS (
  SELECT draft_batch, sig, gen_random_uuid() k FROM msg WHERE has_text
  GROUP BY draft_batch, sig
  HAVING count(DISTINCT campaign_id) >= 2 AND count(*) = count(DISTINCT campaign_id))
UPDATE public.group_campaign_scheduled_messages m
SET sync_key = ok.k::text||':'||coalesce(m.block_order,0)
FROM msg JOIN ok USING (draft_batch, sig)
WHERE COALESCE(m.message_group_id, m.id) = msg.mk AND m.status='draft' AND m.sync_key IS NULL;

-- group_draft_sync_siblings(p_ids uuid[]) -> anchor_id, id, campaign_id, campaign_name,
--   scheduled_at, reason, content_differs  (STABLE, SECURITY DEFINER, exige has_role staff, cap 200)
-- approve_group_drafts_synced(p_anchor_ids uuid[], p_sibling_ids uuid[], p_approved_by text)
--   -> anchor_id, id, campaign_id, ok, reason
--   * valida que cada sibling tem a mesma sync_key de uma âncora e outra campanha;
--   * para cada id (âncora e depois cópias): SELECT ... FOR UPDATE, mesmas validações da
--     approve_group_drafts (lógica extraída para um helper interno _validate_group_draft),
--     UPDATE bloco0->pending / irmãos->grouped dentro de um bloco BEGIN..EXCEPTION por mensagem;
--   * nunca toca scheduled_at, instância nem linhas fora de 'draft'.
REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;
```
A `approve_group_drafts` atual não muda. Para não ficarem duas cópias das validações, a nova função chama o mesmo helper. Mudar a antiga para usar o helper fica para depois, se você quiser.
