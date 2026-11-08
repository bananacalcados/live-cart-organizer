# Auditoria e correções — follow-up das lives

Global desligado, 80/h, 20–60 segundos preservados. Sem publicação, sem mudança em planos, sem mensagens reais.

## Remetente

Resolução única `live_event_sender`, compartilhada por `event-sender.ts` (autoatendimento/catálogo) e pelos contextos SQL em lote (follow-up/check instance_changed): `wa_initial_number_id`, link existente da live, `whatsapp_number_id`. O link intermediário preserva a regra antiga do autoatendimento. O `confirmed_number_id` dos acessos continua preservado nos envios de confirmação existentes.

Live sem número não agenda e aparece no resumo da aba. Instância nula não é pausada. Nenhum fallback de conversa/global.

Trecho confirmado do transporte:
```ts
// _shared/instance-guard.ts
if (req.headers.get('x-force-instance') === 'true') return { ok: true };
// uazapi-send-message/index.ts
const { token } = await resolveUazapiCredentials(whatsapp_number_id);
const r = await uazapiInstance('/send/text', token, { method: 'POST', body: payload });
```
O guard só permite/bloqueia; não troca o número. O follow-up envia `x-force-instance: true`.

## Instagram

Comentário não abre 24h. Contexto central ignora comentários espelhados como mensagens recebidas; somente DM recebida abre janela. Primeiro F: prazo salvo/padrão 2 min, resposta privada em comentário da live, recentes primeiro, apenas com transmissão ativa e marcador de live não expirado. Depois do fim: `live_ended_no_private_reply`. DM com janela aberta pode usar envio normal. Passos posteriores exigem janela e param com resposta da cliente; o limite de resposta mantém o marco original da sequência, sem apagar respostas durante o primeiro envio.

Chat recebe contexto do servidor, mostra prazo/possibilidade real e passa a lista validada nos envios de texto e mídia. Resposta privada é reservada atomicamente no histórico existente; grava o comentário efetivamente usado. Envio incerto nunca volta a ser elegível. Posts/reels: 7 dias; live: somente durante transmissão. Proveniência desconhecida bloqueia conservadoramente. Não consultamos a Meta em testes; os sinais locais de transmissão podem ficar obsoletos, e a Meta continua autoridade final.

Documentação: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies

## LID

Não existia vínculo persistente confiável de LID↔telefone. Criado mapa service-only, RLS, com chave por instância/LID e índice reverso telefone. Webhook salva somente par fornecido pelo provedor (`chatid @lid` + `sender_pn` real), nunca nomes/grupos. Contexto usa esses aliases nos checks de resposta, opt-out e mensagem manual, antes do envio.

**Limitação histórica:** LID antigo sem telefone confirmado no payload não permite identificar a cliente com segurança. Não vinculamos por nome. Nos registros atuais da Pérola com 18 dígitos e `is_group=false`, os dois encontrados tinham o mesmo ID começando `120363` e não tinham `sender_phone`; esse padrão também aparece em grupos. Não há evidência para transformá-los em telefone de cliente. O novo mapa resolve pares futuros comprovados; dados antigos sem par seguem sem correspondência verificável.

## Simulação — LIVE - SITE - 07-11-26

Leitura paginada de 434 fontes (pedidos + acessos sem pedido), sem salvar jobs e sem habilitar o global. Ignora `enabled_since` somente em memória para inspecionar dados históricos; não representa um backfill automático. Os números abaixo são **candidatos por classificação**, antes das paradas finais, jitter, atraso e deduplicação por sequência:

| Tipo | Jobs candidatos | Remetente resolvido |
|---|---:|---|
| A | 102 | Whats Pérola |
| B | 0 | Whats Pérola (regra, sem candidatos) |
| C | 3 | Whats Pérola |
| D | 9 (3 carrinhos × 3) | Whats Pérola |
| E | 0 | Whats Pérola (regra, sem candidatos) |
| F | 84 (21 pedidos × 4) | @bananacalcados |

F privado permitido **agora: 0**; 21 iniciais bloqueados por live encerrada. Um comentário de post recente encontrado não autoriza F após o fim da live. D antigos ainda passam pela trava >15 min, portanto candidatos não significam mensagens enviáveis. Com global desligado, jobs reais criados **0**, envios **0**, chamadas a provedores **0**.

## Verificação

- 39 testes Vitest passaram (prazos, limite 80/h, janela, F durante live e regressão do diálogo de Pix).
- RPC `live_followup_policy_simulate`: 16 verificações verdadeiras, rollback confirmado, 0 chamadas externas: remetente principal/fallback/ausente, comentário≠DM, live ativa/encerrada, 7 dias posts, 24h DM, reserva privada única, LID resposta/opt-out/manual e isolamento por instância.
- Aba autenticada carregada no navegador, global desligado e histórico sem erro após correção do resumo. Chat principal aberto com cliente que comentou em Reel, exibindo “Sem janela: aguarde ela mandar mensagem”; nenhum envio feito. Dialog da live, chat principal e chat embutido compartilham o contexto; meta-messenger-send também delega Instagram ao mesmo guard.
- Aba mantém 3 consultas iniciais, sem polling; chat principal acrescenta 2 leituras delimitadas (perfil + contexto) por abertura/atualização, sem polling. Dialog da live acrescenta 1 contexto ao perfil já carregado.
- Candidato protegido preservado, jobs reais continuam zero.

Entrega real e recebimento de uma nova mensagem LID não foram testados por proibição de mensagens reais. Antes de ligar, conferir em live controlada os sinais de transmissão e a correspondência do provedor. Histórico LID sem par comprovado não foi recuperado.