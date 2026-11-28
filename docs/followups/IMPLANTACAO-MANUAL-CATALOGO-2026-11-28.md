# Correção autorizada durante a live — manual e catálogo

## Entrada em produção

**28/11/2026, 17:42:26.124882 UTC (14:42:26 Brasília).** Matthews autorizou explicitamente apenas esta correção durante a live; as outras entregas continuam com a trava anterior.

- Agendador implantado primeiro, com guarda que conserva as fontes D enquanto o contexto não informa o corte. Isso evita a janela entre corrigir o gatilho e bloquear o histórico.
- Migração `0335_live_manual_catalog_followup_fix.sql` aplicada em seguida, atomicamente: corrige o gatilho, instala o corte fixo e limita o encerramento por acesso compartilhado ao pedido efetivo do job.
- `sender=v2` mantido. Não houve alteração na prioridade, teto 80/h por número, ritmo 20–60 s, remetente por live, regra D por etapa, validade existente, B/C ou caminhos de pagamento/cadastro/ofertas.
- Nenhum frontend foi alterado. Nada precisa de publicação do site para esta correção; não publicar.

## Causas comprovadas

1. **Qualquer origem de pedido:** o gatilho de pedido tenta resolver `NEW.order_ids`, que não existe em `orders`; o bloco de exceção desfaz sua própria fonte e mantém o pedido. O mesmo erro explica os 22 pedidos `origin='catalog'` com carrinho enviado e zero jobs nos últimos dez dias.
2. **Classificação do catálogo:** E era testado antes de D. Um carrinho de catálogo de quem já pagou no dia ganhava E 3/6/24 h, mesmo depois do link do carrinho. Agora D 10/25/45 min tem precedência depois do envio. **E não foi removido:** permanece no cenário de catálogo antes do link, com suas regras atuais; jobs E existentes não foram apagados ou reprocessados.
3. **Recorrência com acesso compartilhado:** `linked_closed` examinava qualquer pedido pago no acesso. Agora, quando há pedido no job, só aquele pedido encerra sua cobrança; pagamento/cancelamento do pedido cobrado continuam bloqueando. Uma compra anterior paga não derruba a segunda compra aberta.

### Origem nula e Joana

`live-catalog` cria pedidos novos com `origin='catalog'`. Antes de inserir, busca pedido aberto já existente da mesma cliente/live e coloca os itens nele sem mudar a origem. Isso é preservação deliberada da origem e de descontos manuais; não mudar para `catalog` à força, pois afetaria outras regras.

Na leitura do caso Joana, o convite foi criado às 16:25:15.850908 UTC, mas o link tinha `opened_at` nulo e `open_count=0`. O segundo pedido não tinha itens com `catalog_product_id`. Assim, **não há prova de que ele foi criado/adicionado pelo catálogo**: proximidade de horários não prova origem. O agendamento D corrigido independe dessa identificação.

O pedido `001e06c5-a0b8-4323-9a2c-27e760729613`, link manual às 16:38:17.935, é anterior à aplicação: **não foi recuperado**, como exigido. O mesmo cenário funciona para carrinhos novos a partir do corte, com ou sem acesso.

## Sem retroativos ou duplicação

- Qualquer novo agendamento D, inclusive catálogo/vitrine/autoatendimento, exige base do carrinho >=17:42:26.124882 UTC.
- A trava de 60 min continua; sozinha admitiria carrinhos de 20 min antes da aplicação. A guarda nova exclui esses casos.
- D com atraso >15 min continua sendo descartado pelo enviador existente; D25/45 mantêm prioridade/folga e motivos atuais.
- Não foram varridos pedidos antigos para enfileirar fontes; não alterados carimbos ou jobs existentes.
- O upsert permanece `ignoreDuplicates` em `(customer_key,sequence_key,step)`; a sequência é por pedido e não por cliente apenas.
- Pedido pago, pago externamente, cancelado, sem produtos ou mesclado não agenda cobrança; o enviador revalida antes de enviar.
- Se surgisse um lote novo para carrinhos anteriores ao corte/mais de 15 min atrás, seria interrompido/cancelado com `vencido_sem_sentido`, conforme a autorização. Contagens da observação abaixo documentam se isso foi necessário.

## Testes e evidência de deploy

- Antes: teste catálogo falhou escolhendo E em vez de D; teste SQL falhou mantendo o segundo pedido fechado e sem fonte. A ausência de corte também falhou.
- Depois: 79 testes focados passaram; mais um teste de auditoria simulada confirmou contagem de D sem gravar jobs/chamar provedor. **Suíte completa: 1.376 testes em 205 arquivos passaram**, em 88 s, no máximo dois trabalhadores.
- Oito testes Deno de execução também passaram (com `--no-check`, pelos erros de tipos preexistentes já registrados na investigação); não alterado código de transporte ou dos utilitários.
- SQL em PostgreSQL descartável usa o gatilho e o contexto de fontes capturados em produção, e a expressão exata de `linked_closed` do contexto de envio. A expressão anterior retorna verdadeiro para compra anterior paga; corrigida retorna falso para o segundo pedido aberto e verdadeiro para o próprio pedido pago.
- Os três backups SQL foram confrontados por MD5 com produção antes de aplicar:
  - dirty: `2a9f43fe587db69475779f77eb10d68e`;
  - contexto de fontes: `503c5cc7c0e69048e9eeaac67b9d90bd`;
  - contexto de envio: `ddc3387c1ef0d066411c44aea434f6ee`.
- Hash submetido do primeiro deploy: `34a21ce9e64450dd74da4f7220c739c51e39774d92138cbc005b66e3f2225984`.
- Ajuste de simulação somente leitura, sem efeito na fila real, submetido com hash `c55bb5f9cf6878dc60b670b03490891a6bf1a0ec50732877bb6322c4a1203654`.
- Logs mostraram a versão 1743 respondendo HTTP 200 após a aplicação inicial. A versão final e as contagens são registradas na conclusão.

## Observação de produção — somente leitura

Janela iniciada às 17:42:58 UTC, depois de confirmar o corte e as três definições. Não houve mensagem de teste nem criação de pedido para produzir evidência artificial.

Antes, entre 17:25:20 e 17:40:20 UTC, a fila existente registrava 8 links de carrinho enviados, 6 convites de catálogo, 3 confirmações de cadastro e 7 confirmações de pagamento; oito acessos confirmaram WhatsApp. São referência de tráfego, não promessa de que todo tipo terá novos envios na janela seguinte.

Às 17:44:10: batimentos positivos, zero preso >2 min, zero incidente de alarme novo; uma confirmação de cadastro e uma de pagamento enviadas desde o corte. Ainda não havia novo carrinho após o corte nem job novo: não interpretar ausência de entradas como falha ou como prova de envio D.

Às 17:44:42: continuavam zero carrinhos novos, zero jobs novos, zero D com base anterior ao corte; o pedido antigo da Joana permanecia com zero jobs.

Às 17:48:11: um carrinho novo (`3bb70c56-6d17-4ac1-ade4-c8b39cd70053`, origem nula) teve link enviado às 17:46:57.732703 e ganhou D10/25/45 às 17:47:02.450166, cerca de **4,72 s após o envio**. Horários dos lembretes: 17:57:15.100, 18:12:11.772 e 18:31:45.773 UTC. O A anterior foi cancelado por cadastro concluído, corretamente. Nenhum D antigo, preso ou incidente novo. Um cart_link, duas ofertas, uma confirmação de cadastro e duas de pagamento já haviam sido enviados depois do corte. Não antecipar o D10 para produzir teste: ele ainda não venceu.

Esse carrinho de tráfego natural tinha acesso online e carimbo automático (`selfservice_cart_sent_at`), sem carimbo manual. Assim, comprova o agendamento natural e os caminhos preservados, **não equivale a teste real de carrinho manual ou origin=catalog**; esses cenários têm cobertura automatizada e não foram forçados em produção.

Às 17:49:51: os três D do carrinho natural estavam cancelados; nenhuma mensagem D havia saído. Cart_link continuava com um envio, ofertas com três, cadastro com um e confirmações de pagamento com três. Zero D antigo ou preso. O motivo e o pagamento são conferidos na leitura seguinte.

Os logs confirmaram a versão final **1745**, quatro execuções HTTP 200 entre 17:45:08 e 17:48:02; versões 1743 anteriores também sem erro.

### Conclusão — leitura final às 17:53:23 UTC

Janela de cerca de dez minutos concluída (17:42:58–17:53:23). Três carrinhos novos geraram **nove D**, todos com base posterior ao corte. Os dois primeiros pedidos pagaram antes do D10: seis etapas canceladas com motivo `paid`; as três etapas do terceiro estavam aguardando seus horários. Nenhum dos D novos havia vencido/enviado na janela.

| Pedido novo | Base do carrinho UTC | Situação dos três D |
|---|---|---|
| `3bb70c56-6d17-4ac1-ade4-c8b39cd70053` | 17:46:57.732703 | Cancelados por pagamento às 17:49:30.950 |
| `2a23332d-c2eb-40d0-b4b3-7a9b499e3fbf` | 17:50:22.394578 | Cancelados por pagamento às 17:52:43.930 |
| `445d6f6d-82d7-4c30-968f-d4d977885ff2` | 17:52:12.543150 | Pendentes: 18:01:42.126, 18:17:01.881, 18:37:57.414 |

Todos tinham origem nula e carimbo automático; **nenhuma entrada nova manual ou origin=catalog foi observada**. Esses dois cenários permanecem verificados por testes, não por mensagem artificial para cliente real.

- Zero D novo com base anterior ao corte ou com base >15 min antiga ao ser criado; nenhuma limpeza/cancelamento de lote antigo foi necessária.
- Zero duplicidade de etapa, preso >2 min, nova falha/incerteza ou incidente de alarme.
- Agendador/enviador continuaram com batimentos positivos e sem erro; versão final 1745 respondeu HTTP 200, nove execuções retornadas no trecho final de logs.
- Caminhos protegidos tiveram **3 cart_link, 4 confirmações de cadastro, 3 convites de cross-sell, 5 confirmações de pagamento e 2 códigos Pix enviados** desde o corte.
- Um **D25 já agendado antes da correção** saiu às 17:53:11.025: pedido `aa51f2db-7e86-4c04-908b-58aa03f6dacc`, criado na fila às 17:26:02.088566, base 17:25:46.891435, horário previsto 17:51:07.062, atraso **123,963 s (2 min 04 s)**. Não foi reprocessamento/reagendamento novo; o pedido continuava não pago. Isso comprova que o envio existente continuou operando sem ser interrompido.
- O pedido antigo da Joana continuou com zero jobs; não renovado nem reenviado. Interruptores: v2, produtos ERP e redirecionamento mobile off, intactos.

## Como desfazer

`docs/followups/ROLLBACK-MANUAL-CATALOG.sql` restaura somente o produtor anterior e mantém a guarda/corte dos carrinhos antigos. Isso interrompe a recuperação nova, sem reenviar, mexer no trabalhador ou nos jobs já criados. Não foi executado.

As três definições anteriores e o código completo anterior estão em `docs/followups/rollback/20261128-*`. Um retorno integral deve preservar a guarda de corte até a inspeção das fontes, para não abrir uma janela de retroativos. Aplicar reversão SQL por nova migração, nunca editando a migração aplicada; restaurar código e implantar apenas o agendador se necessário. Nenhuma restauração automática de pedidos/dados.

## Limitações

- Nenhuma mensagem real de teste: somente o tráfego natural pode comprovar envio após a aplicação.
- Atribuição histórica da origem de Joana não pode ser inferida pelo horário do convite; dados atuais não demonstram abertura do catálogo.
- As outras entregas/mobile não foram misturadas: permanecem na ordem e com a autorização própria.