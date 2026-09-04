# Linhas de etapas de atendimento na aba Pedidos (Live modo WhatsApp)

## Ideia em uma frase

A barra de cards que hoje mostra **uma** linha por vez (Aguardando / Concluídos / Erros) vira um **painel com 4 linhas fixas, todas visíveis ao mesmo tempo**, e o Kanban da Live ganha um botão de minimizar para abrir espaço.

```text
┌ NOVOS CONTATOS (12) ───────────────────────────────────────────── ▸ rolagem horizontal ┐
│ [card contato] [card contato] [card contato] …                                          │
├ AGUARDANDO PAGAMENTO (10) ─────────────────────────────────────────────────────────────┤
│ [card pedido] [card pedido] …  (idêntico ao de hoje)                                    │
├ PAGAMENTOS CONCLUÍDOS (11) ────────────────────────────────────────────────────────────┤
│ [card pedido] [card pedido] …  (idêntico ao de hoje)                                    │
├ DÚVIDAS & CANCELAMENTOS (3) ───────────────────────────────────────────────────────────┤
│ [card contato/pedido] …                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
[ Erros de Pagamento (2) ]  ← vira um botão pequeno que abre a lista atual em janela
[ ▾ Kanban da Live — minimizado ]  ← clique expande
```

Regras de movimentação entre linhas (automáticas, sem intervenção):

| Situação | Linha |
| --- | --- |
| Digitou o WhatsApp no link `/zap` deste evento (falou ou não) e ainda não tem pedido | Novos Contatos |
| Pedido criado e não pago | Aguardando Pagamento |
| Pedido pago | Pagamentos Concluídos |
| Pedido cancelado | Dúvidas & Cancelamentos |
| Contato/pedido movido manualmente pelo atendente ("só tirou dúvida") | Dúvidas & Cancelamentos |

Movimento manual: menu no card com "Mover para Dúvidas" e "Voltar para Novos Contatos". Se depois um pedido for criado para esse telefone, a regra automática vence e o card sobe para Aguardando Pagamento.

Isso aparece apenas nas lives em **modo WhatsApp**; nos modos Manual e Área de Membros a barra continua como está.

## Etapas de implementação

### Etapa 1 — Painel de 4 linhas + Kanban minimizável (só com o que já existe no banco)

- Novo componente `LiveStageLanes` substitui `EventPaymentCardsBar` na aba Pedidos quando a live está em modo WhatsApp.
- Linhas Aguardando e Concluídos reaproveitam o card atual (mesmo visual do print: @, telefone, valor, selos SEM RESPOSTA / Etapa x/3, fixar, clique abre o chat). Nada muda nelas além da posição.
- Linha Novos Contatos lê os cliques confirmados do link deste evento (`live_whatsapp_clicks` com `entered_phone`, não substituídos) mais os leads de origem "Link WhatsApp", já descontando quem tem pedido no evento (casamento por DDD + 8 dígitos). Card mostra nome (ou "Lead WhatsApp"), telefone, há quanto tempo digitou, selo "falou" / "não falou ainda" e botão "Criar pedido" (abre o mesmo diálogo da Central já com telefone e nome).
- Linha Dúvidas & Cancelamentos nesta etapa mostra apenas pedidos cancelados (movimento manual chega na Etapa 2).
- Erros de Pagamento vira um botão com contador que abre a lista atual em janela.
- Cada linha tem contador, rolagem horizontal própria e pode ser recolhida individualmente; estado de recolhida fica salvo no aparelho por evento.
- Botão "Minimizar Kanban" na aba Pedidos; recolhido por padrão nas lives em modo WhatsApp, escolha salva no aparelho por evento. Minimizado mostra só uma faixa com contadores por etapa.
- Atualização em tempo real: a linha Novos Contatos escuta inserções/alterações nos cliques e leads do evento; as linhas de pedido já usam o fluxo em tempo real existente.

Nuances tratadas: mesma pessoa com vários cliques aparece uma vez (o mais recente); clique com telefone digitado diferente do número real usa o real quando já casou. Quem nunca digitou o telefone no link do evento NÃO aparece nas linhas — a ideia é justamente não poluir com conversas sem ligação com a Live.

### Etapa 2 — Movimento manual e persistência da linha "Dúvidas"

- Nova tabela `event_contact_lanes` (evento + chave do telefone DDD+8 → linha, motivo, quem moveu, quando). Chave por telefone para funcionar para contato sem pedido e para pedido.
- Menu no card: "Mover para Dúvidas & Cancelamentos" (com motivo opcional curto) e "Voltar para Novos Contatos". Pedidos pagos não podem ser movidos.
- Regra de precedência: pedido pago > pedido aguardando > movimento manual > cancelado/novo contato. Ao criar pedido para um telefone marcado em Dúvidas, o card sobe sozinho e a marcação manual é limpa.
- Contador de "Dúvidas" e pequeno rótulo com o motivo no card.

### Etapa 3 — Ações rápidas nas linhas e integração com a Central

- No card de Novos Contatos: botão "Mensagem" que abre o chat na instância certa (a que recebeu a mensagem; se ainda não falou, a instância fixada da live) e reaproveita as Ações rápidas já existentes (link autenticado, checkout, ficha).
- Para quem "clicou e não falou": envio da mensagem inicial não-API pelo rodízio já existente, um a um, respeitando opt-out/bloqueio — sem disparo em massa automático.
- Selo de "não lida" no card quando chega mensagem nova (mesmo sinal usado na fila da Central).
- Filtro de busca da aba Pedidos passa a filtrar as 4 linhas.

## Detalhes técnicos

- Arquivos principais: `src/pages/Index.tsx` (troca condicional da barra + minimizar Kanban), novo `src/components/events/LiveStageLanes.tsx`, extração dos cards de `EventPaymentCardsBar.tsx` para um `EventOrderMiniCard` reutilizável (sem duplicar lógica de pin/etapa/chat).
- Fontes de dados da Etapa 1: `live_whatsapp_links` (por `event_id`) → `live_whatsapp_clicks` (`entered_phone`, `phone`, `real_phone`, `superseded`, `lead_id`), `event_leads` (origem link WhatsApp), pedidos já em memória no `dbOrderStore`. Casamento por sufixo de 8 dígitos, padrão do projeto.
- Etapa 2 exige uma migração (tabela `event_contact_lanes` com GRANT, RLS para usuários autenticados, `updated_at` com gatilho).
- Nenhuma alteração em regras de pagamento, disparos ou templates. Nada muda para lives fora do modo WhatsApp.

## Como vou executar

Implemento uma etapa por vez e paro para você validar antes da próxima. Começo pela Etapa 1 assim que aprovar.
