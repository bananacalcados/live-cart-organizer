# Bug: renomear grupos da LIVE-20 alterou um grupo da LIVE-27

## O que está acontecendo (causa raiz confirmada no banco)

Cada grupo físico do WhatsApp está salvo **4 vezes** na tabela de grupos:
- 3 cópias no formato moderno `...@g.us` — uma para **cada instância uazapi** ativa (3 números conectados);
- 1 cópia **legada** no formato antigo `...-group`, presa a uma instância **morta** do Z-API (token cru `3ED1FFCA...`, que nem existe mais na lista de números).

Isso acontece porque a sincronização grava uma linha por instância (a regra de unicidade é por `grupo + instância`). Resultado: 5 grupos físicos viraram 20 registros.

A campanha **LIVE - 20 de Junho** tem 6 alvos selecionados, mas eles caíram em registros **duplicados/legados**:

```text
LIVE-20 (6 alvos) → na verdade 5 grupos físicos:
  • 4 registros legados "...-group" (instância morta 3ED1FFCA...)
  • 1 registro duplicado: o grupo 1203...415356 aparece 2x (legado + @g.us)
```

### Por que UM grupo da LIVE-27 foi renomeado
Um dos registros legados da LIVE-20 é o grupo físico `120363427586598950-group`.
Ao aplicar o nome, o sistema **normaliza** `-group` → `@g.us` e renomeia o **grupo físico** `120363427586598950`.
Esse mesmo grupo físico é justamente o que a **LIVE-27** usa (`120363427586598950@g.us`). Por isso, na tela, o grupo "renomeado" apareceu na LIVE-27.

### Por que só um funcionou e os outros deram erro/timeout
- Os demais registros legados apontam grupos onde a instância ativa (que assume o lugar da instância morta) **não é admin** → falham.
- Há um grupo duplicado dentro da própria LIVE-20 → tenta renomear 2x.
- São 6 grupos × várias subchamadas em sequência → o tempo estoura e aparece o erro.

## Plano de correção (sem quebrar nada)

### Parte 1 — Blindagem no código (seguro, sem perda de dados)
Em `CampaignBulkSettings.tsx`, no `fetchGroupsWithProvider`:
1. **Deduplicar por grupo físico** (apenas os dígitos do `group_id`): manter 1 registro por grupo, preferindo o formato `@g.us` ligado a uma instância **UUID ativa**, descartando os registros legados `-group`/token morto.
2. **Tela de confirmação antes de aplicar nome/foto/etc.**: listar os grupos físicos que serão afetados, a instância usada e um **aviso em vermelho** se o mesmo grupo físico também pertencer a outra campanha (evita renomear grupo de outra live por engano).

Isso já impede: renomear o mesmo grupo 2x, usar instância morta, e renomear grupo de outra campanha sem o usuário perceber.

### Parte 2 — Limpeza dos dados das campanhas (precisa da sua decisão)
Reescrever `target_groups` das duas campanhas para apontar os **registros canônicos** (`@g.us` na instância da campanha `fb7dd381`), deduplicados.

**Decisão necessária:** o grupo físico `120363427586598950` ("Live - Lançamentos Junho #3") está hoje nas DUAS campanhas. Você disse que ele é da LIVE-27. Opções:
- (A) **Remover** da LIVE-20, manter só na LIVE-27 (recomendado pelo que você descreveu); ou
- (B) Manter nas duas (aí qualquer renomeação em massa afetará as duas — não recomendado).

Nenhuma linha de grupo será **apagada** (apagar dispararia exclusão em cascata de mensagens históricas). Os registros legados serão apenas marcados como inativos e retirados das campanhas.

### Parte 3 — Causa sistêmica (opcional, maior)
Ajustar a sincronização de grupos para **atualizar** o registro existente (casando pelos dígitos do `group_id`) em vez de criar uma nova linha por instância — eliminando a fonte das duplicatas. Já há rascunho disso em `.lovable/plan.md`.

## Arquivos afetados
- `src/components/marketing/CampaignBulkSettings.tsx` (dedup + confirmação)
- Migração de dados para `group_campaigns.target_groups` (após sua decisão A/B)
- (Parte 3, se aprovar) funções de sync `uazapi-groups` / `wasender-groups` / `zapi-list-groups`

## Validação
- Pré-visualizar a renomeação da LIVE-20 e conferir que só 5 grupos distintos aparecem, todos da LIVE-20, com instância ativa.
- Confirmar que a LIVE-27 não é mais tocada.
- Testar 1 renomeação real após a limpeza.
