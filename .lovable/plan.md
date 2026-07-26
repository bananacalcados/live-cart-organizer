## Objetivo

No modal de criação de mensagens de Grupos VIP (Marketing > Grupos VIPs > campanha), permitir:
1. Renomear o botão "Enviar Mensagem" para **Agendar**.
2. Ao agendar, o modal **não fecha** e aparece uma confirmação.
3. Novo botão **Agendar em Outra Campanha**, que lista as demais campanhas, permite escolher uma e confirmar o agendamento da MESMA mensagem, usando a data/horário escolhidos no próprio modal.

## Comportamento final

```text
[Cancelar]  [Enviar Agora]  [Agendar em Outra Campanha]  [Agendar]

Ao clicar em "Agendar em Outra Campanha":
  → abre um painel dentro do modal com a lista das outras campanhas
  → seleciono uma campanha (radio/lista clicável)
  → aparece botão [CONFIRMAR]
  → clico → toast "AGENDAMENTO CONFIRMADO"
  → painel fecha, modal de mensagem continua aberto
```

- "Enviar Agora" continua igual (envia na hora e fecha o modal).
- "Agendar" agenda na campanha atual, mostra toast "Agendamento confirmado" e **mantém o modal aberto** (mensagem preservada para reaproveitar em outra campanha).
- Em modo de edição de mensagem existente, nada muda: continua "Salvar" e fechando o modal.

## Detalhes técnicos

**1. `src/components/marketing/CampaignDetailPanel.tsx`**
- Extrair a lógica de `handleAddMessage` para uma função `insertScheduledMessage(data, targetCampaignId, targetNumberId)` — mesma montagem de blocos/`message_group_id`/`block_order` que existe hoje, só parametrizando `campaign_id` e `whatsapp_number_id`. Nenhuma mudança de schema.
- `handleAddMessage` passa a chamar essa função com a campanha atual (comportamento atual preservado).
- Nova prop passada ao formulário:
  - `otherCampaigns`: já existe o fetch `fetchOtherCampaignGroups` (`group_campaigns` com `.neq('id', campaignId)`); estender o select para incluir `whatsapp_number_id` e `is_active`, e reaproveitar a lista.
  - `onScheduleToCampaign(data, campaignId)`: usa `insertScheduledMessage` com o `whatsapp_number_id` da campanha de destino (fallback: o número atual).
- `fetchMessages()` só é chamado quando o destino for a campanha atual (evita re-render desnecessário).

**2. `src/components/marketing/ScheduledMessageForm.tsx`**
- Novas props opcionais: `otherCampaigns?: {id, name, whatsapp_number_id}[]` e `onScheduleToCampaign?: (data, campaignId) => Promise<void>`. Sendo opcionais, nenhum outro uso do componente quebra.
- Rodapé:
  - Botão principal: texto `Agendar` (mantém `Salvar` quando `editingMessage`).
  - `handleSubmit` deixa de chamar `resetForm()`/`onOpenChange(false)` no fluxo de novo agendamento; em vez disso mostra `toast.success("Agendamento confirmado")` e mantém estado.
  - Botão `Agendar em Outra Campanha` (visível só quando `!editingMessage` e há outras campanhas) alterna um painel inline acima do rodapé.
- Painel de seleção: lista rolável das outras campanhas com destaque na selecionada; ao ter seleção, exibe `CONFIRMAR`. Ao confirmar: valida (mesma `validate()`), chama `onScheduleToCampaign(buildData(), campanhaEscolhida)`, exibe toast **"AGENDAMENTO CONFIRMADO"**, limpa a seleção e fecha só o painel.
- Reaproveita a data/horário já preenchidos no modal (`buildData()`), como pedido.

## Riscos e mitigação
- Nenhuma alteração de banco, edge function ou fluxo de disparo — só inserção na tabela já existente `group_campaign_scheduled_messages` com outro `campaign_id`.
- Props novas são opcionais, então o componente segue compatível.
- O botão "Enviar Agora" e a edição de mensagens não são tocados.
