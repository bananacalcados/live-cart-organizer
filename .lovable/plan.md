# Fase 2 — Aba central "Aprovação" nos Grupos VIP

Só plano. Nada foi alterado. Reaproveita a Fase 1 (sync_key, group_draft_sync_siblings, approve_group_drafts_synced, _validate_group_draft, _group_draft_signature).

## Dados reais conferidos agora
- 43 rascunhos no bloco 0: 31 com vínculo e 18 com horário no passado.
- 42 blocos extras ("grouped"): 36 pertencem a mensagens ainda em rascunho, e nenhum tem vínculo. Há 11 mensagens vinculadas que têm blocos extras.
- Só 3 usuários têm papel de acesso, e os 3 são admin. O resto da equipe entra no Marketing pela permissão por módulo ("marketing", via get_user_allowed_modules), que hoje as funções da Fase 1 não aceitam.

## O que você vai ver
1. Em Marketing > Grupos VIP aparece a aba **Aprovação**, a primeira da lista, com um contador de rascunhos prontos.
2. Filtros no topo: lote, status (Prontos / Bloqueados / Conteúdo diferente / Horário passado) e dia. A lista mostra um card por mensagem, e rolar até o fim carrega mais 50.
3. Cada card mostra:
   - a prévia de todos os blocos (texto, foto/vídeo, enquete, contato), o lote e o selo "Claude";
   - chips com cada campanha de destino, assim: `Vips Gv 10:05 · pronta`, `Vips Gv #2 10:10 · sem foto` (vermelho), `Live 10:00 · conteúdo diferente` (amarelo) e `horário passado` (cinza com relógio).
   - Um rascunho sem vínculo vira um card com um destino só.
4. **Aprovar** (por card, ou marcando vários): abre o mesmo resumo da Fase 1, com uma caixa por cópia. "Conteúdo diferente" vem desmarcada, a cópia bloqueada aparece sem caixa e com o motivo, e o horário no passado pede o "Entendi". Nada é aprovado sem confirmar. O resultado sai separado por campanha.
5. **Foto/mídia:** no bloco do card, use "Trocar mídia". O arquivo sobe uma vez e a mesma URL vai para todas as cópias vinculadas ainda em rascunho. Dentro da campanha, o espelhamento por texto continua como está.
6. **Editar:** o lápis em cada bloco abre texto/legenda, opções da enquete, "marcar todos", contato e "sem prévia de link". Embaixo fica "Aplicar em: todas as cópias (padrão) / só em: [caixas por campanha]". Antes de salvar aparece "vai alterar N cópias", e depois o resultado de cada cópia.
7. **Desvincular:** no menu de cada chip, use "Desvincular desta mensagem". A cópia passa a ser um card próprio, e a campanha pode ter texto diferente.
8. **Horário passado:** tem selo e filtro próprios. Com o filtro ligado aparece o botão "Excluir rascunhos selecionados". Ele só apaga o que você marcar, pede confirmação e nunca roda sozinho.

## Consultas (sem repetição automática)
- Abrir a aba: 1 consulta de lista (50 cards) e 1 de filtros (lotes e dias). Rolar até o fim: +1 por página.
- Mudar filtro: 1 consulta. Aprovar: 1 para abrir o resumo (a da Fase 1) e 1 para aprovar. Editar, trocar mídia ou desvincular: 1 cada, e depois só o card afetado é recarregado.
- Não há atualização periódica. O botão "Atualizar" é manual.

## Respostas aos pontos
- **Horários (7):** a edição nunca mexe no horário. Recomendo deixar de fora agora a opção "deslocar todas em X minutos". Ela mexe no ritmo anti-spam e pode cair no passado. Se precisar, vira uma Fase 2e separada, que só soma X minutos mantendo os intervalos e recusa resultado no passado.
- **Acesso (9):** hoje só os 3 admins usariam a aba. Proposta: uma nova checagem que aceita papel admin/manager/user OU a permissão do módulo Marketing, usada só pelas funções novas e pelas da Fase 1. Assim, quem já abre Grupos VIP consegue aprovar, e quem não tem Marketing continua barrado. A aprovação antiga dentro da campanha não muda.
- **Colunas editáveis (4):** message_content, media_url, media_type/mime (só junto com a mídia), poll_options, poll_max_options, mention_all, contact_name, contact_phone e disable_link_preview. Ficam fora: horário, campanha, instância, status, tipo do bloco, ordem, modo do link VIP e lote.

## Casos de borda
- **Cópia aprovada no meio da edição:** cada linha é travada e conferida como rascunho dentro da mesma transação. A que já saiu de rascunho volta como "já aprovada, não alterada", e as outras seguem.
- **Edição que deixaria vazio:** é recusada por cópia ("texto vazio"), exceto em bloco de mídia com legenda vazia, que é permitido. Mídia nunca fica vazia em bloco de foto/vídeo.
- **Mídia faltando:** o chip mostra "sem foto", e o "Trocar mídia" resolve todas as cópias de uma vez.
- **Enquete com menos de 2 opções:** a edição é recusada antes de gravar.
- **{{link_atendimento}} sem modo:** é aceito na edição, mas a cópia fica bloqueada com o motivo (a mesma regra da aprovação). O modo não é editado aqui.
- **Blocos em quantidades diferentes entre campanhas:** a edição atinge só as cópias que têm aquele bloco (mesma chave). As que não têm aparecem como "sem esse bloco", e o card marca "conteúdo diferente".
- **Campanha sem instância:** o chip fica bloqueado "sem número"; a edição é permitida e a aprovação, não.
- **Rascunho sem vínculo:** edição e aprovação só nele.

## Sub-etapas (cada uma reversível)
- **2a, leitura e aprovação:** aba, lista paginada, filtros, aprovação pela função da Fase 1 e nova checagem de acesso.
- **2b, chave nos blocos extras:** backfill e regra para a criação futura.
- **2c, mídia:** "Trocar mídia" sincronizado.
- **2d, edição de texto/enquete/contato:** com "aplicar em".
- **2e, desvincular e excluir rascunhos antigos selecionados.**
- **(opcional, fora por ora)** deslocar horários.

## Detalhes técnicos

Navegação: `GroupsVipManager.tsx` ganha `TabsTrigger value="approval"` com o novo componente lazy `GroupDraftsApprovalTab.tsx` (+ `GroupDraftCard.tsx`, `GroupDraftEditDialog.tsx`). O diálogo de resumo da Fase 1 é extraído de `CampaignDetailPanel.tsx` para `SyncedApprovalDialog.tsx` e usado nos dois lugares, sem mudar o comportamento. O agrupamento e os testes ficam em `src/lib/groupDraftCards.ts`.

Migração 0184 (2a + 2b):
```sql
CREATE OR REPLACE FUNCTION public._can_review_group_drafts() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND (public._is_group_staff()
    OR 'marketing' = ANY(public.get_user_allowed_modules(auth.uid())))  -- ajustar ao tipo de retorno real
$$;
-- group_draft_sync_siblings e approve_group_drafts_synced passam a usar _can_review_group_drafts()

-- 2b: chave nos blocos extras de mensagens em rascunho vinculadas
UPDATE group_campaign_scheduled_messages g
SET sync_key = split_part(p.sync_key,':',1)||':'||coalesce(g.block_order,0)
FROM group_campaign_scheduled_messages p
WHERE p.message_group_id = g.message_group_id AND coalesce(p.block_order,0)=0
  AND p.status='draft' AND p.sync_key IS NOT NULL
  AND g.status='grouped' AND g.id<>p.id AND g.sync_key IS NULL;
CREATE INDEX IF NOT EXISTS idx_gcsm_sync_key_grouped ON group_campaign_scheduled_messages (sync_key)
  WHERE sync_key IS NOT NULL AND status='grouped';

CREATE FUNCTION public.group_draft_cards(p_batch text, p_status text, p_day date,
  p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb  -- [{card_key, batch, blocks:[...], copies:[{id,campaign_id,campaign_name,scheduled_at,reason,content_differs,past}]}]
-- card_key = split_part(sync_key,':',1) ou id; limite de 200; usa idx_gcsm_sync_key_draft e status='draft'

CREATE FUNCTION public.update_group_drafts_synced(p_block_id uuid, p_patch jsonb, p_only_ids uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid, campaign_id uuid, ok boolean, reason text)
-- _can_review_group_drafts(); patch só com chaves da lista permitida (outras chaves dão erro);
-- alvo = linhas com a mesma sync_key do bloco; a linha "dona" (bloco 0) precisa estar em 'draft'
--   (blocos extras 'grouped' de mensagem em rascunho entram; os de mensagem aprovada não);
-- SELECT ... FOR UPDATE ordenado por id; atualiza só se IS DISTINCT FROM; limite de 200 linhas.

CREATE FUNCTION public.unlink_group_draft(p_id uuid) RETURNS boolean
-- zera sync_key da mensagem toda (bloco 0 + extras) só se estiver em rascunho

CREATE FUNCTION public.delete_group_drafts(p_ids uuid[]) RETURNS int
-- apaga só rascunhos selecionados (e seus blocos extras); limite de 200
```
Todas com REVOKE de PUBLIC/anon e GRANT para authenticated. A `approve_group_drafts` antiga não muda.

Criação futura: o `CampaignDetailPanel` e o Claude geram um uuid por mensagem lógica e gravam `uuid:block_order` em todos os blocos de todas as cópias (a regra do AGENTS.md já diz isso; reforçar "inclusive os blocos extras").

Reversão: o front volta a esconder a aba; `DROP FUNCTION` nas funções novas; a checagem volta para `_is_group_staff`; `UPDATE ... SET sync_key=NULL WHERE status='grouped'` desfaz o 2b. A Fase 1 fica intacta.

## Testes
- **Unitários:** agrupamento em cards, status dos chips, "conteúdo diferente", blocos em quantidades diferentes e lista permitida de colunas.
- **Banco, sempre com ROLLBACK:**
  - backfill 2b (contar as 36 linhas esperadas);
  - lista paginada com filtros e limite;
  - edição sincronizada de texto e mídia no bloco 3, atingindo o mesmo bloco nas outras cópias;
  - recusa de cópia já aprovada, enquete com 1 opção, texto vazio e coluna proibida;
  - horários iguais antes e depois;
  - desvincular;
  - excluir só os selecionados;
  - usuário sem Marketing barrado, e com Marketing liberado.
- **Tela (Playwright), sem clicar em confirmar aprovação:** aba, filtros, rolagem, chips e diálogos.
- Nunca aprovar mensagem real.

## Perguntas em aberto (com recomendação)
1. **Acesso pela permissão do módulo Marketing?** Recomendo **sim**.
2. **"Deslocar horários" fica fora?** Recomendo **fora**.
3. **"Excluir rascunhos antigos": só os selecionados, ou também um "selecionar todos do filtro"?** Recomendo **só os selecionados, com "marcar todos da página"**.
4. **Edição em "Conteúdo diferente": o padrão "todas as cópias" inclui as que estão diferentes?** Recomendo **não**: elas vêm desmarcadas, igual na aprovação.
