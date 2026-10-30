# Auditoria — compra da Meta no autoatendimento (Appmax + sinais fbc/fbp)

## Respostas

### 1) Por que o Appmax não dispara o Purchase no autoatendimento
- `appmax-webhook/index.ts` (l. 360-370) **não chama a Meta**. Só grava `is_paid=true, paid_at, stage='paid'` no pedido. Quem dispara é o gatilho do banco `trigger_meta_capi_purchase_on_paid` em `orders`, para todos os modos.
- **Quem preenche `meta_capi_purchase_sent_at` sem log:** o próprio gatilho. Ele chama `meta-capi-event` com `net.http_post` sem esperar a resposta e, na linha seguinte, já grava `NEW.meta_capi_purchase_sent_at := now()`. Ou seja, **marca "enviado" antes de enviar** e nunca confere o resultado. Por isso os horários de `sent_at` e `paid_at` diferem só em milissegundos nos 49 pedidos.
- **Onde falha:** `meta-capi-event/index.ts` l. 195-198. No autoatendimento, um Purchase sem `selfservice_cashback_receipt` primeiro roda `grantSelfserviceCashback`. Em `_shared/selfservice-cashback.ts` l. 59-62, para Appmax isso consulta `appmaxGetPayment` e lança erro ("Pagamento Appmax não confirmado" ou "aguardando valor e horário oficiais", l. 76). O erro cai no `catch` geral (l. 593), que devolve 500 **antes** do pré-registro no log (l. 493). Resultado: nada vai para a Meta, nada fica no log, e o gatilho já marcou "enviado".
- Prova nos dados: 47 dos 49 pedidos estão **sem recibo de cashback** (o cashback deles também não saiu). No modo antigo esse bloco não roda, por isso o Appmax funciona. Mercado Pago e AustPay passam porque a conferência deles funciona.
- **Ainda não confirmado:** o motivo exato da falha na conferência Appmax (status fora da lista, `dateApproved` vazio ou id diferente). O registro dessa função não tem histórico disponível, então isso é o primeiro passo da correção. Os 2 pedidos que têm recibo e mesmo assim não têm log também entram nessa verificação.
- O `meta-capi-purchase-retry` não salva esses pedidos: ele chama o mesmo `meta-capi-event` e cai no mesmo erro.

### 2) Onde o Purchase do autoatendimento monta fbc/fbp/IP/UA
- `meta-capi-event/index.ts` l. 216: no autoatendimento **apaga** fbc, fbp, telefone e e-mail recebidos na chamada. As l. 429-431 e 486 também ignoram IP, UA e URL vindos da chamada.
- A única fonte que sobra é `customer_registrations` **por `order_id`** (l. 219-237). Nos 49 pedidos, quase nenhuma ficha tem fbc (só 3).
- Não lê `live_selfservice_accesses.advertising_signals` em nenhum lugar: só `live-selfservice` grava esse campo. Também pula a memória de atribuição (`meta_attribution_identities`, l. 361, `!selfservice`) e o reaproveitamento de IP/UA por telefone (l. 286).
- **Cookies do carrinho:** `SelfServiceCartPage.tsx` l. 109 só dispara o Purchase do **navegador** (pixel) com o mesmo event_id. Ele não manda cookies ao servidor.
- **Como o sinal se perde:** a página `/pedido/<slug>` abre no navegador interno do Instagram, que tem `_fbc` (vindo do fbclid) e `_fbp`. Por isso o acesso tem 98-99%. O link do carrinho chega pelo WhatsApp e abre no navegador interno do WhatsApp ou no Chrome/Safari. Cada um guarda cookies separados: lá não existe `_fbc` (o link não tem fbclid) e um `_fbp` novo pode ser criado. O pixel do navegador perde o fbc, e o servidor não tem de onde buscar. Os 10%/41% atuais vêm só das poucas fichas com cookie salvo.

### 3) Fluxo antigo (modo `whatsapp`, link gerado pela equipe)
- Sem o bloqueio da l. 216, o servidor usa, em cascata: cookies enviados pelo checkout → ficha do pedido → **memória de atribuição por qualquer telefone da cliente** (l. 361-381, 90 dias, alimentada por `/zap/:slug`, LPs e área de membros) → IP/UA da última ficha pelo mesmo telefone (l. 286-300).
- Por isso chega a 28% de fbc e 74% de fbp: o fbp sobrevive em qualquer visita já registrada para o telefone, e o fbc só quando houve clique em anúncio registrado.

## Proposta de correção (só autoatendimento; modos antigos intactos)

**(a) Sinais do acesso como fonte principal no autoatendimento** — `meta-capi-event`
- Quando `selfservice`, buscar o acesso por `order_ids` contendo o pedido (já indexado no fluxo atual). Se não achar, buscar por `confirmed_phone_key` / `phone_key` **do mesmo evento**. Ler `advertising_signals` (fbc, fbp, client_ip, client_user_agent, event_source_url).
- Prioridade: ficha do pedido → acesso → nada. Sem misturar com o telefone de outras pessoas, seguindo a regra atual "registro exato, sem enriquecer por telefone compartilhado".
- A recusa de propaganda continua bloqueando tudo. Event_id `purchase_order_<id>` e event_time real ficam iguais (dedupe com o pixel preservado).

**(b) Appmax disparar com log**
- Mudar o pedaço do autoatendimento em `meta-capi-event`: falha do cashback **não bloqueia** o Purchase (regra já existente: "cashback não verificado não bloqueia a notificação"). O valor sai do recibo quando existir; senão, da confirmação do webhook (`paid_at` + total do pedido).
- Pré-registrar a linha `pending` **antes** de qualquer passo que possa falhar, e gravar `error` com a mensagem quando falhar.
- Gatilho do banco: parar de marcar `meta_capi_purchase_sent_at` na hora do disparo. Só a função marca, depois do OK da Meta (ela já faz isso, l. 553-558). Para não reenviar em dobro, uma linha no log com `pending`/`sent` já bloqueia novo disparo. O gatilho segue igual para os outros modos; só muda essa marcação.
- Primeiro, descobrir e corrigir a causa da falha na conferência Appmax em `_shared/selfservice-cashback.ts`, para o cashback desses clientes também sair.

**(c) Reenvio retroativo dos 49**
- Rodar uma vez, pelo `meta-capi-purchase-retry` (modo por lista de pedidos), com event_time = `paid_at` real, event_id igual e sinais do acesso.
- **Janela de 7 dias (agora: 30/10 15:40 UTC):** todos os 49 ainda estão dentro.
  - 24/10: 16 pedidos, **vencem amanhã, 31/10 por volta de 15:48 UTC (12:48 de Brasília)**. Urgente.
  - 27/10: 19 pedidos, vencem em 03/11.
  - 29/10: 14 pedidos, vencem em 05/11.
- Antes de reenviar, limpar `meta_capi_purchase_sent_at` só desses 49.

## Arquivos que seriam alterados
- `supabase/functions/meta-capi-event/index.ts` — sinais do acesso, pré-log antecipado, cashback sem bloquear.
- `supabase/functions/_shared/selfservice-cashback.ts` — corrigir a conferência Appmax (depois de achar a causa).
- Nova migração: o gatilho `trigger_meta_capi_purchase_on_paid` para de marcar "enviado" antes da hora.
- `supabase/functions/meta-capi-purchase-retry/index.ts` — aceitar lista de pedidos para o reenvio.
- Teste novo: pedido do autoatendimento sem cookie usa fbc/fbp do acesso; falha do cashback ainda gera o Purchase com log.
- Nenhuma mudança no `appmax-webhook`.

## Riscos
- **Contagem dupla:** o pixel do navegador e o servidor usam o mesmo event_id, e a Meta deduplica em até 48 h. Nos reenvios com mais de 48 h, o navegador já não conta (dedupe pelo event_id), então o risco é baixo.
- **Acesso errado:** buscar por telefone pode pegar o acesso de outra pessoa que usa o mesmo número. Mitigação: só `order_ids` exato ou telefone do **mesmo evento**, nunca entre eventos.
- **Mudança no gatilho** atinge todos os modos. Mitigação: manter o disparo igual e só mover a marcação. Pedidos antigos com `sent_at` preenchido não reenviam.
- **Valor sem recibo:** usar o total do pedido pode diferir do valor realmente pago (ex.: parte em VPS). Mitigação: com divisão de pagamento, usar só as partes em dinheiro/cartão aprovadas.
- **Prazo:** os 16 pedidos de 24/10 saem da janela amanhã ao meio-dia (Brasília).
